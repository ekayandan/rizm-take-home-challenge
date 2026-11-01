/** Local calendar dates as YYYY-MM-DD: checking them and writing them for people. */

/** True for a date that exists: 2026-02-30 has the right shape but doesn't. */
export function isValidDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === v;
}

const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });

/** "6 Oct" */
export const shortDate = (date: string) => format(date, { day: "numeric", month: "short" });
/** "6 Oct 2026" */
export const longDate = (date: string) => format(date, { day: "numeric", month: "short", year: "numeric" });
