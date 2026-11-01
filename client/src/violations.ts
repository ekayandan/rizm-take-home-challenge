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

/**
 * How much of a day's measured state has both readings. A day owns the state points after its
 * first step (all of them on the first day), the same points its measured breaches come from.
 */
export function readingCoverage(s: { step_start: number; measured: { temperature_c: (number | null)[]; co2_ppm: (number | null)[] } }) {
  const from = s.step_start === 0 ? 0 : 1;
  const t = s.measured.temperature_c.slice(from);
  const c = s.measured.co2_ppm.slice(from);
  const complete = t.filter((v, i) => v !== null && c[i] !== null).length;
  return { total: t.length, missing: t.length - complete, any: [...t, ...c].some((v) => v !== null) };
}

/** What a missing reading means for the limit check; null when every reading is there. */
export function missingReadingsNote(coverage: ReturnType<typeof readingCoverage>): string | null {
  if (!coverage.missing) return null;
  if (!coverage.any) return "No sensor readings for this day, so the limits could not be checked.";
  return `Some sensor readings are missing (${coverage.missing} of ${coverage.total}), so only part of the day could be checked.`;
}

export const num = (v: number, digits: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Below the shown precision a breach still counts, so it must not read as 0,00. */
export const amount = (v: number, digits: number) => (v < 10 ** -digits ? `< ${num(10 ** -digits, digits)}` : num(v, digits));
