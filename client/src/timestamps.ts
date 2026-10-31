/** Short readable timestamps in a given timezone. */
const LOCALE = "en-GB";
const HOUR_MS = 3600_000;

/** "6 Oct", with the year only when it is not the current one. */
function datePart(utc: string, timeZone: string, now: Date): string {
  const year = (d: Date) => new Intl.DateTimeFormat(LOCALE, { year: "numeric", timeZone }).format(d);
  const d = new Date(utc);
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric", month: "short", timeZone, ...(year(d) === year(now) ? {} : { year: "numeric" }),
  }).format(d);
}

function zoneAt(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, timeZoneName: "short" }).formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** "08:00", with the zone name only within an hour of a clock change, where the time alone can be ambiguous. */
function timePart(utc: string, timeZone: string): string {
  const ms = Date.parse(utc);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(ms);
  const zone = zoneAt(ms, timeZone);
  const nearChange = zoneAt(ms - HOUR_MS, timeZone) !== zone || zoneAt(ms + HOUR_MS, timeZone) !== zone;
  return nearChange ? `${time} ${zone}` : time;
}

/** "6 Oct, 08:00" */
export function formatInstant(utc: string, timeZone: string, now = new Date()): string {
  return `${datePart(utc, timeZone, now)}, ${timePart(utc, timeZone)}`;
}

/** "6 Oct, 08:00 – 14:00"; the end names its day when that differs. */
export function formatRange(startUtc: string, endUtc: string, timeZone: string, now = new Date()): string {
  const sameDay = datePart(startUtc, timeZone, now) === datePart(endUtc, timeZone, now);
  const end = sameDay ? timePart(endUtc, timeZone) : formatInstant(endUtc, timeZone, now);
  return `${formatInstant(startUtc, timeZone, now)} – ${end}`;
}
