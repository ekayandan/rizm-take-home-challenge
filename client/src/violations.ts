/** Types and formatting of measured limit breaches for the day view. */

/** A comfort bound broken by the measured state; over is how far past the limit (K or ppm). */
export interface MeasuredViolation {
  step: number;
  ts_utc: string;
  constraint: "temp_below_min" | "temp_above_max" | "co2_above_max";
  value: number;
  limit: number;
  over: number;
}

export const num = (v: number, digits: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Below the shown precision a breach still counts, so it must not read as 0,00. */
export const amount = (v: number, digits: number) => (v < 10 ** -digits ? `< ${num(10 ** -digits, digits)}` : num(v, digits));
