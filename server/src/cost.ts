/** Cost of a hall's schedule for one local day, via the checker's simulate(). */
import { simulate, type Instance, type Report, type Schedule } from "../checker/checker.ts";
import type { DB } from "./db.ts";
import { getSteps, loadInstance, loadSchedule, stepRange } from "./repo.ts";

export type InitialStateSource = "simulated" | "measured";

export interface DayCost extends Report {
  hall_id: string;
  schedule: string;
  date: string;
  step_start: number;
  step_end: number;
  steps: number;
  initial_state: { temperature_c: number; co2_ppm: number };
  initial_state_source: InitialStateSource;
  violations: (Report["violations"][number] & { ts_utc: string })[];
}

export class NotFound extends Error {}
export class BadRequest extends Error {}

/** Steps [start, end) of an instance as a standalone instance starting from `initial`. */
export function sliceInstance(inst: Instance, start: number, end: number, initial: Instance["initial_state"]): Instance {
  const s = inst.series, b = inst.bounds;
  return {
    ...inst,
    horizon: { ...inst.horizon, steps: end - start },
    initial_state: initial,
    series: {
      price_eur_per_mwh: s.price_eur_per_mwh.slice(start, end),
      outdoor_temp_c: s.outdoor_temp_c.slice(start, end),
      internal_heat_kw: s.internal_heat_kw.slice(start, end),
      co2_generation_m3_per_h: s.co2_generation_m3_per_h.slice(start, end),
      occupancy_persons: s.occupancy_persons?.slice(start, end),
    },
    bounds: {
      temp_min_c: b.temp_min_c.slice(start, end + 1),
      temp_max_c: b.temp_max_c.slice(start, end + 1),
      co2_max_ppm: b.co2_max_ppm.slice(start, end + 1),
    },
  };
}

export function sliceSchedule(s: Schedule, start: number, end: number): Schedule {
  return {
    mass_flow_kg_per_s: s.mass_flow_kg_per_s.slice(start, end),
    recirculation: s.recirculation.slice(start, end),
    heating_kw: s.heating_kw.slice(start, end),
    cooling_kw: s.cooling_kw.slice(start, end),
  };
}

const STATE_CONSTRAINTS = new Set(["temp_below_min", "temp_above_max", "co2_above_max"]);

/**
 * Simulates `schedule` over the local day `date` of a hall.
 *
 * The day starts from the state the same schedule reaches at local midnight when run from
 * the start of the horizon (`simulated`, default), or from the measured state at midnight
 * (`measured`). The state at the first step of a day is produced by the previous day, so its
 * bound violations are reported on that day (except on the first day of the horizon): with
 * `simulated`, the day costs and violations add up to the full-horizon report.
 */
export function dayCost(
  db: DB,
  hallId: string,
  scheduleName: string,
  date: string,
  opts: { initial?: InitialStateSource; trace?: boolean } = {},
): DayCost {
  const initialSource = opts.initial ?? "simulated";
  const inst = loadInstance(db, hallId);
  if (!inst) throw new NotFound(`hall '${hallId}' not found`);
  const sched = loadSchedule(db, hallId, scheduleName);
  if (!sched) throw new NotFound(`hall '${hallId}' has no schedule '${scheduleName}'`);
  const range = stepRange(db, hallId, date, date);
  if (!range) throw new BadRequest(`date ${date} is outside the horizon of hall '${hallId}'`);
  const { start, end } = range;

  const stepRows = getSteps(db, hallId, start, end);
  let initial: Instance["initial_state"];
  if (initialSource === "measured") {
    const r = stepRows[0];
    if (r.measured_temperature_c === null || r.measured_co2_ppm === null) {
      throw new BadRequest(`no measured state at the start of ${date}`);
    }
    initial = { temperature_c: r.measured_temperature_c, co2_ppm: r.measured_co2_ppm };
  } else if (start === 0) {
    initial = inst.initial_state;
  } else {
    initial = simulate(sliceInstance(inst, 0, start, inst.initial_state), sliceSchedule(sched, 0, start)).final_state;
  }

  const report = simulate(sliceInstance(inst, start, end, initial), sliceSchedule(sched, start, end), { trace: opts.trace });
  const violations = report.violations
    .filter((v) => !(start > 0 && v.step === 0 && STATE_CONSTRAINTS.has(v.constraint)))
    .map((v) => ({ ...v, step: v.step + start, ts_utc: stepRows[v.step].ts_utc }));

  return {
    ...report,
    instance: hallId,
    hall_id: hallId,
    schedule: scheduleName,
    date,
    step_start: start,
    step_end: end,
    steps: end - start,
    initial_state: initial,
    initial_state_source: initialSource,
    feasible: violations.length === 0,
    n_violations: violations.length,
    violations,
  };
}
