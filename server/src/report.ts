/**
 * Weekly report of a site: what the plans cost, how long the measured state was out of bounds
 * and the most expensive intervals. The CSV is written from the same data as the page.
 */
import { simulate, type Instance, type Report, type Schedule, type Violation } from "../checker/checker.ts";
import { BadRequest } from "./cost.ts";
import type { DB } from "./db.ts";
import {
  getSteps, listHalls, listMaintenanceWindows, listScheduleNames, loadInstance, loadSchedule,
  type HallRow, type MaintenanceWindowRow, type SiteRow, type StepRow,
} from "./repo.ts";
import { measuredViolations } from "./violations.ts";

const TOP_INTERVALS = 3;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface TopInterval {
  hall_id: string;
  hall_name: string;
  ts_utc: string;
  local_date: string;
  /** "14:15", or "02:30 (first, CEST)" when the clock change makes that time occur twice. */
  local_time: string;
  price_eur_per_mwh: number;
  cost_eur: number;
}

export interface ReportFigures {
  baseline_eur: number | null;
  optimized_eur: number | null;
  post_intervention_eur: number | null;
  /** Baseline minus post-intervention. Overstated when intervention_limit_hours is above zero. */
  savings_eur: number | null;
  /** Hours in which the plan, once the windows are applied, breaks limits it otherwise keeps. */
  intervention_limit_hours: number;
  hours_out_of_bounds: number;
  /** Hours of the week with a price; the clock-change week has 169 when complete. */
  hours_covered: number;
  /** Hours of the week that have no price and so cost nothing here. */
  hours_without_price: number;
  interventions: number;
  top_intervals: TopInterval[];
}

export interface HallReport extends ReportFigures {
  hall_id: string;
  name: string;
  from: string | null;
  to: string | null;
}

export interface WeeklyReport {
  site: { id: string; name: string; city: string };
  week: { start: string; end: string; partial: boolean };
  /** How to read the figures; the page and the CSV both carry them. */
  notes: string[];
  summary: ReportFigures;
  halls: HallReport[];
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export function requireMonday(week: string): void {
  if (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) throw new BadRequest(`'week' must be a Monday, got '${week}'`);
}

/**
 * `schedule` with the windows in force applied and nothing else re-planned. A step touched by
 * a window loses the asset for all of its 15 minutes. Without the fan no air moves, and the
 * coils only act on air that flows, so a fan window stops them too.
 */
export function applyMaintenance(schedule: Schedule, tsUtc: string[], dtHours: number, windows: Pick<MaintenanceWindowRow, "asset" | "start_utc" | "end_utc">[]): Schedule {
  const out: Schedule = {
    mass_flow_kg_per_s: [...schedule.mass_flow_kg_per_s],
    recirculation: [...schedule.recirculation],
    heating_kw: [...schedule.heating_kw],
    cooling_kw: [...schedule.cooling_kw],
  };
  const spans = windows.map((w) => ({ asset: w.asset, start: Date.parse(w.start_utc), end: Date.parse(w.end_utc) }));
  tsUtc.forEach((ts, k) => {
    const from = Date.parse(ts), to = from + dtHours * HOUR_MS;
    for (const w of spans) {
      if (w.start >= to || w.end <= from) continue;
      if (w.asset === "fan") {
        out.mass_flow_kg_per_s[k] = 0;
        out.heating_kw[k] = 0;
        out.cooling_kw[k] = 0;
      }
      if (w.asset === "boiler") out.heating_kw[k] = 0;
      if (w.asset === "chiller") out.cooling_kw[k] = 0;
    }
  });
  return out;
}

/** Local time of each step, saying which one it is when the clock change makes it occur twice. */
function localTimeLabels(rows: StepRow[], timeZone: string): Map<number, string> {
  const steps = new Map<string, StepRow[]>();
  for (const r of rows) steps.set(`${r.local_date} ${r.local_time}`, [...(steps.get(`${r.local_date} ${r.local_time}`) ?? []), r]);
  const labels = new Map<number, string>();
  for (const same of steps.values()) {
    same.forEach((r, n) => {
      if (same.length === 1) return void labels.set(r.step, r.local_time);
      const zone = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(Date.parse(r.ts_utc)).find((p) => p.type === "timeZoneName")?.value;
      labels.set(r.step, `${r.local_time} (${n === 0 ? "first" : "second"}, ${zone})`);
    });
  }
  return labels;
}

function stepCosts(inst: Instance, schedule: Schedule): number[] {
  return simulate(inst, schedule, { trace: true }).trace!.cost_eur;
}

/** The steps from `first` to `last` where `after` breaks a limit that `before` keeps. */
function newlyBrokenSteps(before: Report, after: Report, first: number, last: number): Set<number> {
  const key = (v: Violation) => `${v.step} ${v.constraint}`;
  const known = new Set(before.violations.map(key));
  return new Set(after.violations.filter((v) => v.step >= first && v.step <= last && !known.has(key(v))).map((v) => v.step));
}

const sumOver = (costs: number[], steps: StepRow[]) => steps.reduce((a, r) => a + costs[r.step], 0);

const topOf = (intervals: TopInterval[]) =>
  [...intervals].sort((a, b) => b.cost_eur - a.cost_eur || a.ts_utc.localeCompare(b.ts_utc)).slice(0, TOP_INTERVALS);

function hallReport(db: DB, hall: HallRow, start: string, end: string): { report: HallReport; intervals: TopInterval[] } {
  const rows = getSteps(db, hall.id, 0, hall.steps - 1);
  const inWeek = rows.filter((r) => r.local_date >= start && r.local_date <= end);
  const priced = inWeek.filter((r) => r.price_eur_per_mwh !== null);
  const windows = listMaintenanceWindows(db, hall.id);
  const firstMs = inWeek.length ? Date.parse(inWeek[0].ts_utc) : 0;
  const lastMs = inWeek.length ? Date.parse(inWeek.at(-1)!.ts_utc) + hall.dt_hours * HOUR_MS : 0;

  const figures: HallReport = {
    hall_id: hall.id,
    name: hall.name,
    from: priced[0]?.local_date ?? null,
    to: priced.at(-1)?.local_date ?? null,
    baseline_eur: null,
    optimized_eur: null,
    post_intervention_eur: null,
    savings_eur: null,
    intervention_limit_hours: 0,
    hours_out_of_bounds: 0,
    hours_covered: priced.length * hall.dt_hours,
    hours_without_price: (inWeek.length - priced.length) * hall.dt_hours,
    interventions: windows.filter((w) => inWeek.length > 0 && Date.parse(w.start_utc) < lastMs && Date.parse(w.end_utc) > firstMs).length,
    top_intervals: [],
  };
  if (!priced.length) return { report: figures, intervals: [] };

  // As in dayCost(), the state at the first step of a period belongs to the period before it.
  const firstState = inWeek[0].step === 0 ? 0 : inWeek[0].step + 1;
  const outOfBounds = new Set(measuredViolations(getSteps(db, hall.id, firstState, inWeek.at(-1)!.step + 1)).map((v) => v.step));
  figures.hours_out_of_bounds = outOfBounds.size * hall.dt_hours;

  const known = listScheduleNames(db, hall.id);
  const inst = loadInstance(db, hall.id)!;
  if (known.includes("baseline")) figures.baseline_eur = sumOver(stepCosts(inst, loadSchedule(db, hall.id, "baseline")!), priced);
  if (!known.includes("optimized")) return { report: figures, intervals: [] };

  const optimized = loadSchedule(db, hall.id, "optimized")!;
  figures.optimized_eur = sumOver(stepCosts(inst, optimized), priced);
  const blocked = applyMaintenance(optimized, rows.map((r) => r.ts_utc), hall.dt_hours, windows);
  const costs = stepCosts(inst, blocked);
  figures.intervention_limit_hours = newlyBrokenSteps(simulate(inst, optimized), simulate(inst, blocked), firstState, inWeek.at(-1)!.step + 1).size * hall.dt_hours;
  figures.post_intervention_eur = sumOver(costs, priced);
  if (figures.baseline_eur !== null) figures.savings_eur = figures.baseline_eur - figures.post_intervention_eur;

  const labels = localTimeLabels(priced, hall.timezone);
  const intervals = priced.map((r): TopInterval => ({
    hall_id: hall.id,
    hall_name: hall.name,
    ts_utc: r.ts_utc,
    local_date: r.local_date,
    local_time: labels.get(r.step)!,
    price_eur_per_mwh: r.price_eur_per_mwh!,
    cost_eur: costs[r.step],
  }));
  figures.top_intervals = topOf(intervals);
  return { report: figures, intervals };
}

/** A site total counts only when every hall has the figure. */
function totalOf(halls: HallReport[], key: "baseline_eur" | "optimized_eur" | "post_intervention_eur" | "savings_eur"): number | null {
  if (!halls.length || halls.some((h) => h[key] === null)) return null;
  return halls.reduce((a, h) => a + (h[key] as number), 0);
}

const METHOD_NOTES = [
  "Cost after interventions is the optimized plan with the maintenance windows now in force applied and nothing else re-planned. Blocking equipment lowers this cost by not running it, so that drop is not a saving in itself.",
  "Hours out of bounds come from measured temperature and CO2; an interval counts once however many limits it breaks. Site totals add up the halls' hours.",
  "Figures use the windows in force when the report is generated.",
];

const hoursText = (v: number) => v.toLocaleString("de-DE", { maximumFractionDigits: 2 });

/** The report of the week starting on Monday `week`, in the local dates of the site's halls. */
export function weeklyReport(db: DB, site: SiteRow, week: string): WeeklyReport {
  requireMonday(week);
  const end = addDays(week, 6);
  const results = listHalls(db, site.id).map((h) => hallReport(db, h, week, end));
  const halls = results.map((r) => r.report);
  if (!halls.some((h) => h.from)) throw new BadRequest(`no data for site '${site.id}' in the week of ${week}`);
  const sum = (key: "intervention_limit_hours" | "hours_out_of_bounds" | "hours_covered" | "hours_without_price" | "interventions") => halls.reduce((a, h) => a + h[key], 0);
  const limitHours = sum("intervention_limit_hours");
  return {
    site: { id: site.id, name: site.name, city: site.city },
    week: { start: week, end, partial: halls.some((h) => h.from !== week || h.to !== end || h.hours_without_price > 0) },
    notes: limitHours > 0
      ? [`Savings are overstated: with the interventions applied, the plan breaks limits it otherwise keeps for ${hoursText(limitHours)} hall-hours.`, ...METHOD_NOTES]
      : METHOD_NOTES,
    summary: {
      baseline_eur: totalOf(halls, "baseline_eur"),
      optimized_eur: totalOf(halls, "optimized_eur"),
      post_intervention_eur: totalOf(halls, "post_intervention_eur"),
      savings_eur: totalOf(halls, "savings_eur"),
      intervention_limit_hours: limitHours,
      hours_out_of_bounds: sum("hours_out_of_bounds"),
      hours_covered: sum("hours_covered"),
      hours_without_price: sum("hours_without_price"),
      interventions: sum("interventions"),
      top_intervals: topOf(results.flatMap((r) => r.intervals)),
    },
    halls,
  };
}

/** Decimal comma, as German Excel reads numbers. An unknown figure stays empty. */
const num = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));

/** Quotes where the format needs it, and keeps a spreadsheet from running a name as a formula. */
function text(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const FIGURES_HEADER = ["Baseline cost (EUR)", "Optimized cost (EUR)", "Post-intervention cost (EUR)", "Savings (EUR)", "Hours out of bounds", "Hours covered", "Hours without price", "Interventions", "Hours of new plan limit breaks after interventions"];

const figureCells = (f: ReportFigures) => [
  num(f.baseline_eur), num(f.optimized_eur), num(f.post_intervention_eur), num(f.savings_eur),
  num(f.hours_out_of_bounds), num(f.hours_covered), num(f.hours_without_price), String(f.interventions), num(f.intervention_limit_hours),
];

const intervalLines = (intervals: TopInterval[]) => [
  ["Most expensive intervals"],
  ["Rank", "Hall", "Date", "Time", "Price (EUR/MWh)", "Post-intervention cost (EUR)"],
  ...intervals.map((i, n) => [String(n + 1), text(i.hall_name), i.local_date, i.local_time, num(i.price_eur_per_mwh), num(i.cost_eur)]),
];

/**
 * One file with labelled blocks in the order of the report: the summary, then each hall.
 * Semicolons, decimal commas and a byte order mark make it open correctly in German Excel.
 */
export function reportCsv(r: WeeklyReport): string {
  const lines: string[][] = [
    ["Weekly report", text(r.site.name)],
    ["Week", r.week.start, r.week.end, ...(r.week.partial ? ["Partial week"] : [])],
    ...r.notes.map((n) => ["Note", text(n)]),
    [],
    ["Site summary"],
    ["Hall", ...FIGURES_HEADER],
    ...r.halls.map((h) => [text(h.name), ...figureCells(h)]),
    ["Total", ...figureCells(r.summary)],
    [],
    ...intervalLines(r.summary.top_intervals),
  ];
  for (const h of r.halls) {
    lines.push([], ["Hall", text(h.name)], FIGURES_HEADER, figureCells(h), [], ...intervalLines(h.top_intervals));
  }
  return `﻿${lines.map((l) => l.join(";")).join("\r\n")}\r\n`;
}

export function reportFilename(r: WeeklyReport): string {
  return `weekly-report-${r.site.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${r.week.start}.csv`;
}
