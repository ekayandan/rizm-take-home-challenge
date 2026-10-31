/**
 * Comfort limits broken by what the sensors recorded. simulate() checks a schedule against
 * the model; this checks the measured state against the same bounds with the same tolerance.
 */
import { TOL } from "../checker/checker.ts";
import type { StepRow } from "./repo.ts";

export type MeasuredConstraint = "temp_below_min" | "temp_above_max" | "co2_above_max";

export interface MeasuredViolation {
  step: number;
  ts_utc: string;
  constraint: MeasuredConstraint;
  value: number;
  limit: number;
  /** How far past the limit, always positive (K or ppm). */
  over: number;
}

/**
 * Every bound broken by the measured state in `rows`. A state point with no measurement is
 * skipped, not treated as a breach.
 */
export function measuredViolations(rows: StepRow[]): MeasuredViolation[] {
  const out: MeasuredViolation[] = [];
  const add = (r: StepRow, constraint: MeasuredConstraint, value: number, limit: number) =>
    out.push({ step: r.step, ts_utc: r.ts_utc, constraint, value, limit, over: Math.abs(value - limit) });
  for (const r of rows) {
    const T = r.measured_temperature_c, C = r.measured_co2_ppm;
    if (T !== null && T < r.temp_min_c - TOL) add(r, "temp_below_min", T, r.temp_min_c);
    if (T !== null && T > r.temp_max_c + TOL) add(r, "temp_above_max", T, r.temp_max_c);
    if (C !== null && C > r.co2_max_ppm + TOL) add(r, "co2_above_max", C, r.co2_max_ppm);
  }
  return out;
}
