/** Read access to the seeded database. */
import type { Instance, Schedule } from "../checker/checker.ts";
import type { DB } from "./db.ts";

export interface SiteRow { id: string; name: string; city: string; timezone: string }

export interface HallRow {
  id: string;
  site_id: string;
  name: string;
  notes: string | null;
  timezone: string;
  start_utc: string;
  dt_minutes: number;
  steps: number;
  dt_hours: number;
  constants_json: string;
  room_json: string;
  hvac_json: string;
  initial_state_json: string;
  comfort_json: string | null;
  shifts_json: string | null;
}

export interface StepRow {
  step: number;
  ts_utc: string;
  local_date: string;
  local_time: string;
  utc_offset_min: number;
  price_eur_per_mwh: number | null;
  outdoor_temp_c: number | null;
  internal_heat_kw: number | null;
  co2_generation_m3_per_h: number | null;
  occupancy_persons: number | null;
  temp_min_c: number;
  temp_max_c: number;
  co2_max_ppm: number;
  measured_temperature_c: number | null;
  measured_co2_ppm: number | null;
}

export interface ScheduleStepRow {
  step: number;
  mass_flow_kg_per_s: number;
  recirculation: number;
  heating_kw: number;
  cooling_kw: number;
}

export function listSites(db: DB): SiteRow[] {
  return db.prepare("SELECT id, name, city, timezone FROM sites ORDER BY name").all() as unknown as SiteRow[];
}

export function getSite(db: DB, id: string): SiteRow | undefined {
  return db.prepare("SELECT id, name, city, timezone FROM sites WHERE id = ?").get(id) as unknown as SiteRow | undefined;
}

export function listHalls(db: DB, siteId?: string): HallRow[] {
  if (siteId) return db.prepare("SELECT * FROM halls WHERE site_id = ? ORDER BY name").all(siteId) as unknown as HallRow[];
  return db.prepare("SELECT * FROM halls ORDER BY site_id, name").all() as unknown as HallRow[];
}

export function getHall(db: DB, id: string): HallRow | undefined {
  return db.prepare("SELECT * FROM halls WHERE id = ?").get(id) as unknown as HallRow | undefined;
}

export function listScheduleNames(db: DB, hallId: string): string[] {
  return (db.prepare("SELECT name FROM schedules WHERE hall_id = ? ORDER BY name").all(hallId) as unknown as { name: string }[]).map((r) => r.name);
}

/** Local dates covered by a hall's steps 0 … N-1, with their step range [start, end). */
export function listDays(db: DB, hallId: string): { date: string; step_start: number; step_end: number; steps: number }[] {
  return db
    .prepare(
      `SELECT local_date AS date, MIN(step) AS step_start, MAX(step) + 1 AS step_end, COUNT(*) AS steps
       FROM hall_steps WHERE hall_id = ? AND price_eur_per_mwh IS NOT NULL
       GROUP BY local_date ORDER BY local_date`,
    )
    .all(hallId) as unknown as { date: string; step_start: number; step_end: number; steps: number }[];
}

/** Step range [start, end) of the steps whose local date lies in [from, to]; null if none. */
export function stepRange(db: DB, hallId: string, from: string, to: string): { start: number; end: number } | null {
  const r = db
    .prepare(
      `SELECT MIN(step) AS start, MAX(step) + 1 AS end FROM hall_steps
       WHERE hall_id = ? AND local_date BETWEEN ? AND ? AND price_eur_per_mwh IS NOT NULL`,
    )
    .get(hallId, from, to) as unknown as { start: number | null; end: number | null };
  return r.start === null || r.end === null ? null : { start: r.start, end: r.end };
}

/** Rows for steps start … endInclusive. */
export function getSteps(db: DB, hallId: string, start: number, endInclusive: number): StepRow[] {
  return db
    .prepare(
      `SELECT step, ts_utc, local_date, local_time, utc_offset_min, price_eur_per_mwh, outdoor_temp_c,
              internal_heat_kw, co2_generation_m3_per_h, occupancy_persons, temp_min_c, temp_max_c,
              co2_max_ppm, measured_temperature_c, measured_co2_ppm
       FROM hall_steps WHERE hall_id = ? AND step BETWEEN ? AND ? ORDER BY step`,
    )
    .all(hallId, start, endInclusive) as unknown as StepRow[];
}

export function getScheduleSteps(db: DB, hallId: string, name: string, start: number, endExclusive: number): ScheduleStepRow[] {
  return db
    .prepare(
      `SELECT step, mass_flow_kg_per_s, recirculation, heating_kw, cooling_kw FROM schedule_steps
       WHERE hall_id = ? AND schedule_name = ? AND step >= ? AND step < ? ORDER BY step`,
    )
    .all(hallId, name, start, endExclusive) as unknown as ScheduleStepRow[];
}

export function scheduleFromRows(rows: ScheduleStepRow[]): Schedule {
  return {
    mass_flow_kg_per_s: rows.map((r) => r.mass_flow_kg_per_s),
    recirculation: rows.map((r) => r.recirculation),
    heating_kw: rows.map((r) => r.heating_kw),
    cooling_kw: rows.map((r) => r.cooling_kw),
  };
}

/** Rebuilds the checker `Instance` for the full horizon of a hall. */
export function loadInstance(db: DB, hallId: string): Instance | undefined {
  const h = getHall(db, hallId);
  if (!h) return undefined;
  const rows = getSteps(db, hallId, 0, h.steps);
  const inputs = rows.slice(0, h.steps);
  const num = (v: number | null) => v as number;
  return {
    name: h.id,
    horizon: { steps: h.steps, dt_hours: h.dt_hours },
    constants: JSON.parse(h.constants_json),
    room: JSON.parse(h.room_json),
    hvac: JSON.parse(h.hvac_json),
    initial_state: JSON.parse(h.initial_state_json),
    series: {
      price_eur_per_mwh: inputs.map((r) => num(r.price_eur_per_mwh)),
      outdoor_temp_c: inputs.map((r) => num(r.outdoor_temp_c)),
      internal_heat_kw: inputs.map((r) => num(r.internal_heat_kw)),
      co2_generation_m3_per_h: inputs.map((r) => num(r.co2_generation_m3_per_h)),
      occupancy_persons: inputs.map((r) => r.occupancy_persons ?? 0),
    },
    bounds: {
      temp_min_c: rows.map((r) => r.temp_min_c),
      temp_max_c: rows.map((r) => r.temp_max_c),
      co2_max_ppm: rows.map((r) => r.co2_max_ppm),
    },
  };
}

export function loadSchedule(db: DB, hallId: string, name: string): Schedule | undefined {
  const h = getHall(db, hallId);
  if (!h) return undefined;
  const rows = getScheduleSteps(db, hallId, name, 0, h.steps);
  return rows.length ? scheduleFromRows(rows) : undefined;
}

/** First and last local date with input data of a hall (null if it has none). */
export function dateRange(db: DB, hallId: string): { first_date: string | null; last_date: string | null } {
  return db
    .prepare(
      `SELECT MIN(local_date) AS first_date, MAX(local_date) AS last_date FROM hall_steps
       WHERE hall_id = ? AND price_eur_per_mwh IS NOT NULL`,
    )
    .get(hallId) as unknown as { first_date: string | null; last_date: string | null };
}

export const ASSETS = ["fan", "boiler", "chiller"] as const;
export type Asset = (typeof ASSETS)[number];

export interface MaintenanceWindowRow {
  id: number;
  hall_id: string;
  asset: Asset;
  start_utc: string;
  end_utc: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

const MAINTENANCE_SELECT = `
  SELECT w.id, w.hall_id, w.asset, w.start_utc, w.end_utc, w.created_by, u.name AS created_by_name, w.created_at
  FROM maintenance_windows w LEFT JOIN users u ON u.id = w.created_by`;

/** A hall's maintenance windows, earliest start first. */
export function listMaintenanceWindows(db: DB, hallId: string): MaintenanceWindowRow[] {
  return db
    .prepare(`${MAINTENANCE_SELECT} WHERE w.hall_id = ? ORDER BY w.start_utc, w.end_utc, w.id`)
    .all(hallId) as unknown as MaintenanceWindowRow[];
}

/** A window of the hall with exactly this asset and these instants, if one was already recorded. */
export function findMaintenanceWindow(
  db: DB,
  w: { hall_id: string; asset: Asset; start_utc: string; end_utc: string },
): MaintenanceWindowRow | undefined {
  return db
    .prepare(`${MAINTENANCE_SELECT} WHERE w.hall_id = ? AND w.asset = ? AND w.start_utc = ? AND w.end_utc = ? ORDER BY w.id LIMIT 1`)
    .get(w.hall_id, w.asset, w.start_utc, w.end_utc) as unknown as MaintenanceWindowRow | undefined;
}

export function insertMaintenanceWindow(
  db: DB,
  w: { hall_id: string; asset: Asset; start_utc: string; end_utc: string; created_by: string },
): MaintenanceWindowRow {
  const r = db
    .prepare(
      `INSERT INTO maintenance_windows (hall_id, asset, start_utc, end_utc, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(w.hall_id, w.asset, w.start_utc, w.end_utc, w.created_by, new Date().toISOString());
  return db.prepare(`${MAINTENANCE_SELECT} WHERE w.id = ?`).get(Number(r.lastInsertRowid)) as unknown as MaintenanceWindowRow;
}
