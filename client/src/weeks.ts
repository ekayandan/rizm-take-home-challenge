/** Monday-to-Sunday weeks of the local dates a site has data for. */
export interface ReportWeek { start: string; end: string; partial: boolean }

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Every week touching first … last, oldest first. Weeks the data covers only in part are marked. */
export function reportWeeks(first: string | null, last: string | null): ReportWeek[] {
  if (!first || !last) return [];
  const weeks: ReportWeek[] = [];
  for (let start = mondayOf(first); start <= last; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    weeks.push({ start, end, partial: start < first || end > last });
  }
  return weeks;
}

/** The last full week, or the latest week when none is full. */
export function defaultWeek(weeks: ReportWeek[]): string | null {
  return (weeks.filter((w) => !w.partial).at(-1) ?? weeks.at(-1))?.start ?? null;
}
