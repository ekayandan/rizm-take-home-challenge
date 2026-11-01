/**
 * What maintenance does to a plan: the stored schedule with the asset blocked and nothing else
 * re-planned, run through the checker and compared with the stored schedule.
 */
import { simulate, type Schedule, type Violation } from "../checker/checker.ts";
import { dayCost, NotFound, type DayCost } from "./cost.ts";
import type { DB } from "./db.ts";
import { getHall, getSteps, loadInstance, loadSchedule, type Asset, type StepRow } from "./repo.ts";

const HOUR_MS = 3_600_000;

export interface BlockedAsset { asset: Asset; start_utc: string; end_utc: string }

/** New violations of one kind over the whole data period. `worst` is how far past the limit. */
export interface NewViolationGroup {
  constraint: string;
  count: number;
  worst: number;
  first_local: string;
  last_local: string;
}

export interface Consequences {
  hall_id: string;
  schedule: string;
  date: string;
  /** Windows simulated, the proposed one included. */
  windows: BlockedAsset[];
  /** Steps of the data period that some window touches, and those where the plan loses output. */
  blocked_steps: number;
  changed_steps: number;
  /** False if no window changes anything the plan does, for example the boiler was not planned to run. */
  plan_changed: boolean;
  /** False if the blocked plan breaks a limit the stored plan keeps, on any day of the data period. */
  still_feasible: boolean;
  new_violations: NewViolationGroup[];
  new_violations_total: number;
  new_violations_on_day: number;
  /** Both reports are traced, and the day's controls of the blocked plan are included for the chart. */
  plan_day: DayCost;
  after_day: DayCost;
  after_controls: Schedule;
}

/**
 * `schedule` with the windows applied and nothing else re-planned. A step touched by a window
 * loses the asset for all of its 15 minutes. Without the fan no air moves, and the coils only
 * act on air that flows, so a fan window stops them too.
 */
export function applyMaintenance(schedule: Schedule, tsUtc: string[], dtHours: number, windows: BlockedAsset[]): Schedule {
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

const violationKey = (v: Pick<Violation, "step" | "constraint">) => `${v.step} ${v.constraint}`;

/** Violations of `after` that `before` does not have, so a plan's own violations aren't blamed on the window. */
export function newViolations<V extends Violation>(before: Violation[], after: V[]): V[] {
  const known = new Set(before.map(violationKey));
  return after.filter((v) => !known.has(violationKey(v)));
}

function pastLimit(v: Violation): number {
  const value = v.value, limit = v.limit;
  if (typeof value !== "number") return 0;
  if (typeof limit === "number") return Math.abs(value - limit);
  return value < limit[0] ? limit[0] - value : Math.max(0, value - limit[1]);
}

function groupViolations(found: Violation[], rows: StepRow[]): NewViolationGroup[] {
  const local = (step: number) => `${rows[step].local_date}T${rows[step].local_time}`;
  const groups = new Map<string, NewViolationGroup>();
  for (const v of found) {
    const g = groups.get(v.constraint);
    if (g) {
      g.count++;
      g.worst = Math.max(g.worst, pastLimit(v));
      g.last_local = local(v.step);
    } else {
      groups.set(v.constraint, { constraint: v.constraint, count: 1, worst: pastLimit(v), first_local: local(v.step), last_local: local(v.step) });
    }
  }
  return [...groups.values()];
}

const sliceControls = (s: Schedule, start: number, end: number): Schedule => ({
  mass_flow_kg_per_s: s.mass_flow_kg_per_s.slice(start, end),
  recirculation: s.recirculation.slice(start, end),
  heating_kw: s.heating_kw.slice(start, end),
  cooling_kw: s.cooling_kw.slice(start, end),
});

/** Consequences of `windows` for one schedule: on the local day `date` and over the whole data period. */
export function consequences(db: DB, hallId: string, scheduleName: string, date: string, windows: BlockedAsset[]): Consequences {
  const hall = getHall(db, hallId);
  const inst = loadInstance(db, hallId);
  if (!hall || !inst) throw new NotFound(`hall '${hallId}' not found`);
  const plan = loadSchedule(db, hallId, scheduleName);
  if (!plan) throw new NotFound(`hall '${hallId}' has no schedule '${scheduleName}'`);

  const rows = getSteps(db, hallId, 0, hall.steps);
  const tsUtc = rows.slice(0, hall.steps).map((r) => r.ts_utc);
  const after = applyMaintenance(plan, tsUtc, hall.dt_hours, windows);

  const blockedAll = applyMaintenance(
    { mass_flow_kg_per_s: tsUtc.map(() => 1), recirculation: tsUtc.map(() => 0), heating_kw: tsUtc.map(() => 1), cooling_kw: tsUtc.map(() => 1) },
    tsUtc, hall.dt_hours, windows,
  );
  let blockedSteps = 0, changedSteps = 0;
  tsUtc.forEach((_, k) => {
    const touched = blockedAll.mass_flow_kg_per_s[k] === 0 || blockedAll.heating_kw[k] === 0 || blockedAll.cooling_kw[k] === 0;
    if (touched) blockedSteps++;
    if (after.mass_flow_kg_per_s[k] !== plan.mass_flow_kg_per_s[k] || after.heating_kw[k] !== plan.heating_kw[k] || after.cooling_kw[k] !== plan.cooling_kw[k]) changedSteps++;
  });

  const planFull = simulate(inst, plan);
  const afterFull = simulate(inst, after);
  const found = newViolations(planFull.violations, afterFull.violations);

  const planDay = dayCost(db, hallId, scheduleName, date, { trace: true });
  const afterDay = dayCost(db, hallId, scheduleName, date, { trace: true, schedule: after });

  return {
    hall_id: hallId,
    schedule: scheduleName,
    date,
    windows,
    blocked_steps: blockedSteps,
    changed_steps: changedSteps,
    plan_changed: changedSteps > 0,
    still_feasible: found.length === 0,
    new_violations: groupViolations(found, rows),
    new_violations_total: found.length,
    new_violations_on_day: newViolations(planDay.violations, afterDay.violations).length,
    plan_day: planDay,
    after_day: afterDay,
    after_controls: sliceControls(after, afterDay.step_start, afterDay.step_end),
  };
}
