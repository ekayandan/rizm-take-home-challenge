/** Local wall-clock parts of an instant in an IANA timezone. */
export function localParts(utcMs: number, timeZone: string): { date: string; time: string; offsetMin: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
  return { date, time, offsetMin };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** UTC offset in minutes as +HH:MM / -HH:MM. */
export function formatOffset(min: number): string {
  const a = Math.abs(min);
  return `${min < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

const LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * The instant of a local wall-clock time "YYYY-MM-DDTHH:MM" in an IANA timezone.
 * Returns null if the text is malformed or the time does not exist there (spring-forward gap).
 * A time that occurs twice (fall-back hour) resolves to its earlier occurrence.
 */
export function localToUtc(local: string, timeZone: string): number | null {
  const m = LOCAL_DT_RE.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(asUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) {
    return null;
  }
  // The offset at the target lies among the offsets a day either side of it.
  const offsets = new Set([-1, 0, 1].map((days) => localParts(asUtc + days * 86_400_000, timeZone).offsetMin));
  const hits = [...offsets]
    .map((off) => asUtc - off * 60_000)
    .filter((t) => {
      const p = localParts(t, timeZone);
      return `${p.date}T${p.time}` === local;
    })
    .sort((a, b) => a - b);
  return hits[0] ?? null;
}
