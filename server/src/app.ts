/**
 * JSON API on node:http. Routes live under /api. Everything except health and the auth
 * routes needs a session cookie (401 without one), and a user only sees the sites assigned
 * to them (admins see all); other sites and their halls answer 404.
 *
 *   GET  /api/health
 *   POST /api/auth/login   {email, password}    sets the session cookie, returns the user
 *   POST /api/auth/logout                       ends the session, clears the cookie
 *   GET  /api/auth/me                           the logged-in user (401 if none)
 *
 * Maintenance windows (an asset of a hall is unavailable between two instants):
 *
 *   GET  /api/halls/:hallId/maintenance        the hall's windows, earliest start first
 *   POST /api/halls/:hallId/maintenance {asset, start, end}
 *                                               asset is fan, boiler or chiller; start and end are
 *                                               local wall-clock times "YYYY-MM-DDTHH:MM" in the
 *                                               hall's timezone (or ISO instants with Z/offset);
 *                                               end must be after start. Admins and operators only.
 *                                               An identical window (same asset and instants) answers 409.
 *
 * All other routes are GET:
 *
 *   /api/sites                                  sites with their halls
 *   /api/sites/:siteId                          one site with its halls
 *   /api/sites/:siteId/cost?date=[&schedule=optimized]
 *                                               cost of a schedule for one local day, per hall
 *                                               and summed over the site's halls
 *   /api/halls[?site=<siteId>]                  halls
 *   /api/halls/:hallId                          hall metadata, physical model, days, schedules
 *   /api/halls/:hallId/series?from=&to=[&schedules=a,b]
 *                                               series, bounds, measured values and schedules
 *                                               for the local dates from … to (inclusive)
 *   /api/halls/:hallId/cost?date=[&schedule=][&initial=simulated|measured][&trace=1]
 *                                               simulate() cost of a schedule for one local day
 *   /api/halls/:hallId/violations?from=&to=     comfort bounds broken by the measured state for the
 *                                               local dates from … to; a day owns the state points
 *                                               after its first step, as in dayCost()
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { dayCost, BadRequest, NotFound, type InitialStateSource } from "./cost.ts";
import {
  authenticate, clearedCookie, createSession, deleteSession, readCookie, sessionCookie, sessionUser, SESSION_COOKIE,
  type User,
} from "./auth.ts";
import { MissingDatabase, transaction, type DB } from "./db.ts";
import {
  ASSETS, dateRange, findMaintenanceWindow, getHall, insertMaintenanceWindow, listMaintenanceWindows, getScheduleSteps, getSite, getSteps, listDays, listHalls, listScheduleNames, listSites, stepRange,
  type Asset, type HallRow, type MaintenanceWindowRow, type SiteRow,
} from "./repo.ts";
import { formatOffset, isIsoDate, localParts, localToUtc } from "./time.ts";
import { measuredViolations } from "./violations.ts";

type Query = URLSearchParams;
type Handler = (db: DB, params: string[], q: Query, user: User) => unknown;

class Unauthorized extends Error {}
class TooManyRequests extends Error {}
class Forbidden extends Error {}
class Conflict extends Error {}

const DB_UNAVAILABLE = "The service is temporarily unavailable. Please try again later.";

function hallSummary(h: HallRow) {
  return { id: h.id, site_id: h.site_id, name: h.name, notes: h.notes, timezone: h.timezone };
}

/** A site with its halls and the span of local dates any of its halls has data for. */
function siteWithHalls(db: DB, s: SiteRow) {
  const halls = listHalls(db, s.id).map((h) => ({
    ...hallSummary(h),
    ...dateRange(db, h.id),
    shifts: h.shifts_json ? JSON.parse(h.shifts_json) : null,
    days: listDays(db, h.id).map(({ date, steps }) => ({ date, steps })),
  }));
  const firsts = halls.map((h) => h.first_date).filter((d): d is string => d !== null).sort();
  const lasts = halls.map((h) => h.last_date).filter((d): d is string => d !== null).sort();
  return { ...s, first_date: firsts[0] ?? null, last_date: lasts.at(-1) ?? null, halls };
}

/**
 * Cost of one schedule for one local day for every hall of a site. A hall without data on
 * that day or without the schedule gets `cost_eur: null` and a `reason`; `complete` tells
 * whether the site total covers all halls.
 */
function siteDayCost(db: DB, site: SiteRow, date: string, schedule: string) {
  const halls = listHalls(db, site.id).map((h) => {
    const base = { hall_id: h.id, name: h.name };
    if (!listScheduleNames(db, h.id).includes(schedule)) {
      return { ...base, cost_eur: null, reason: `no '${schedule}' schedule` };
    }
    if (!stepRange(db, h.id, date, date)) return { ...base, cost_eur: null, reason: "no data for this day" };
    const r = dayCost(db, h.id, schedule, date);
    return {
      ...base,
      cost_eur: r.cost_eur,
      cost_breakdown_eur: r.cost_breakdown_eur,
      energy_kwh: r.energy_kwh,
      feasible: r.feasible,
      n_violations: r.n_violations,
    };
  });
  const priced = halls.filter((h) => h.cost_eur !== null);
  return {
    site_id: site.id,
    date,
    schedule,
    total_cost_eur: priced.length ? priced.reduce((a, h) => a + (h.cost_eur as number), 0) : null,
    complete: priced.length === halls.length && halls.length > 0,
    halls,
  };
}

/** A site the user may see; unassigned sites look exactly like missing ones. */
function requireSite(db: DB, id: string, user: User): SiteRow {
  const s = getSite(db, id);
  if (!s || !user.sites.includes(s.id)) throw new NotFound(`site '${id}' not found`);
  return s;
}

/** A hall on a site the user may see. */
function requireHall(db: DB, id: string, user: User): HallRow {
  const h = getHall(db, id);
  if (!h || !user.sites.includes(h.site_id)) throw new NotFound(`hall '${id}' not found`);
  return h;
}

function requireDate(q: Query, key: string, fallback?: string): string {
  const v = q.get(key) ?? fallback;
  if (v === undefined) throw new BadRequest(`query parameter '${key}' is required (YYYY-MM-DD)`);
  if (!isIsoDate(v)) throw new BadRequest(`'${key}' must be a date as YYYY-MM-DD, got '${v}'`);
  return v;
}

/** Local wall-clock time of an instant in a timezone, as YYYY-MM-DDTHH:MM+HH:MM. */
function localIso(utc: string, timeZone: string): string {
  const p = localParts(Date.parse(utc), timeZone);
  return `${p.date}T${p.time}${formatOffset(p.offsetMin)}`;
}

function maintenanceOut(w: MaintenanceWindowRow, hall: HallRow) {
  return { ...w, start_local: localIso(w.start_utc, hall.timezone), end_local: localIso(w.end_utc, hall.timezone) };
}

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** A body field as a UTC ISO instant: local wall-clock time in the hall's timezone, or an ISO instant with offset. */
function requireInstant(body: Record<string, unknown>, key: string, timeZone: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v) throw new BadRequest(`'${key}' is required (YYYY-MM-DDTHH:MM, local time)`);
  if (INSTANT_RE.test(v)) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  } else {
    const t = localToUtc(v, timeZone);
    if (t !== null) return new Date(t).toISOString();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}Z`))) {
      throw new BadRequest(`The ${key} time ${v} does not exist in ${timeZone} because of the clock change.`);
    }
  }
  throw new BadRequest(`'${key}' must be a date and time as YYYY-MM-DDTHH:MM, got '${v}'`);
}

type PostHandler = (db: DB, params: string[], body: Record<string, unknown>, user: User) => unknown;

const postRoutes: [RegExp, PostHandler][] = [
  [/^\/api\/halls\/([^/]+)\/maintenance$/, (db, [id], body, user) => {
    const hall = requireHall(db, id, user);
    if (user.role !== "admin" && user.role !== "operator") throw new Forbidden("only operators and admins can add maintenance windows");
    const asset = body.asset;
    if (typeof asset !== "string" || !(ASSETS as readonly string[]).includes(asset)) {
      throw new BadRequest(`'asset' must be one of ${ASSETS.join(", ")}`);
    }
    const start = requireInstant(body, "start", hall.timezone);
    const end = requireInstant(body, "end", hall.timezone);
    if (end <= start) throw new BadRequest("'end' must be after 'start'");
    const window = { hall_id: id, asset: asset as Asset, start_utc: start, end_utc: end };
    const row = transaction(db, () => {
      const existing = findMaintenanceWindow(db, window);
      if (existing) {
        throw new Conflict(`This window was already recorded${existing.created_by_name ? ` by ${existing.created_by_name}` : ""}, so it was not added again.`);
      }
      return insertMaintenanceWindow(db, { ...window, created_by: user.id });
    });
    return maintenanceOut(row, hall);
  }],
];

const routes: [RegExp, Handler][] = [
  [/^\/api\/sites$/, (db, _p, _q, user) =>
    listSites(db).filter((s) => user.sites.includes(s.id)).map((s) => siteWithHalls(db, s))],

  [/^\/api\/sites\/([^/]+)$/, (db, [id], _q, user) => siteWithHalls(db, requireSite(db, id, user))],

  [/^\/api\/sites\/([^/]+)\/cost$/, (db, [id], q, user) =>
    siteDayCost(db, requireSite(db, id, user), requireDate(q, "date"), q.get("schedule") ?? "optimized")],

  [/^\/api\/halls$/, (db, _p, q, user) =>
    listHalls(db, q.get("site") ?? undefined).filter((h) => user.sites.includes(h.site_id)).map(hallSummary)],

  [/^\/api\/halls\/([^/]+)$/, (db, [id], _q, user) => {
    const h = requireHall(db, id, user);
    const days = listDays(db, id);
    return {
      ...hallSummary(h),
      start_utc: h.start_utc,
      dt_minutes: h.dt_minutes,
      horizon: { steps: h.steps, dt_hours: h.dt_hours },
      first_date: days[0]?.date ?? null,
      last_date: days.at(-1)?.date ?? null,
      days,
      constants: JSON.parse(h.constants_json),
      room: JSON.parse(h.room_json),
      hvac: JSON.parse(h.hvac_json),
      initial_state: JSON.parse(h.initial_state_json),
      comfort: h.comfort_json ? JSON.parse(h.comfort_json) : null,
      shifts: h.shifts_json ? JSON.parse(h.shifts_json) : null,
      schedules: listScheduleNames(db, id),
    };
  }],

  [/^\/api\/halls\/([^/]+)\/maintenance$/, (db, [id], _q, user) => {
    const hall = requireHall(db, id, user);
    return listMaintenanceWindows(db, id).map((w) => maintenanceOut(w, hall));
  }],

  [/^\/api\/halls\/([^/]+)\/series$/, (db, [id], q, user) => {
    const hall = requireHall(db, id, user);
    const from = requireDate(q, "from");
    const to = requireDate(q, "to", from);
    if (to < from) throw new BadRequest("'to' must not be before 'from'");
    const range = stepRange(db, id, from, to);
    const known = listScheduleNames(db, id);
    const wanted = q.get("schedules") ? q.get("schedules")!.split(",").filter(Boolean) : known;
    for (const name of wanted) if (!known.includes(name)) throw new NotFound(`hall '${id}' has no schedule '${name}'`);
    if (!range) throw new BadRequest(`no data for hall '${id}' between ${from} and ${to}`);

    // Rows start … end: steps start … end-1 carry inputs; the extra row is the end state point.
    const rows = getSteps(db, id, range.start, range.end);
    const stepRows = rows.slice(0, -1);
    const schedules: Record<string, Record<string, number[]>> = {};
    for (const name of wanted) {
      const s = getScheduleSteps(db, id, name, range.start, range.end);
      schedules[name] = {
        mass_flow_kg_per_s: s.map((r) => r.mass_flow_kg_per_s),
        recirculation: s.map((r) => r.recirculation),
        heating_kw: s.map((r) => r.heating_kw),
        cooling_kw: s.map((r) => r.cooling_kw),
      };
    }
    return {
      hall_id: id,
      from,
      to,
      step_start: range.start,
      step_end: range.end,
      steps: range.end - range.start,
      dt_minutes: hall.dt_minutes,
      // N entries, one per step
      ts_utc: stepRows.map((r) => r.ts_utc),
      local_time: stepRows.map((r) => `${r.local_date}T${r.local_time}${formatOffset(r.utc_offset_min)}`),
      series: {
        price_eur_per_mwh: stepRows.map((r) => r.price_eur_per_mwh),
        outdoor_temp_c: stepRows.map((r) => r.outdoor_temp_c),
        internal_heat_kw: stepRows.map((r) => r.internal_heat_kw),
        co2_generation_m3_per_h: stepRows.map((r) => r.co2_generation_m3_per_h),
        occupancy_persons: stepRows.map((r) => r.occupancy_persons),
      },
      schedules,
      // N+1 entries, state points at the start of each step plus the end of the range
      state_ts_utc: rows.map((r) => r.ts_utc),
      bounds: {
        temp_min_c: rows.map((r) => r.temp_min_c),
        temp_max_c: rows.map((r) => r.temp_max_c),
        co2_max_ppm: rows.map((r) => r.co2_max_ppm),
      },
      measured: {
        temperature_c: rows.map((r) => r.measured_temperature_c),
        co2_ppm: rows.map((r) => r.measured_co2_ppm),
      },
    };
  }],

  [/^\/api\/halls\/([^/]+)\/violations$/, (db, [id], q, user) => {
    requireHall(db, id, user);
    const from = requireDate(q, "from");
    const to = requireDate(q, "to", from);
    if (to < from) throw new BadRequest("'to' must not be before 'from'");
    const range = stepRange(db, id, from, to);
    if (!range) throw new BadRequest(`no data for hall '${id}' between ${from} and ${to}`);
    const first = range.start === 0 ? 0 : range.start + 1;
    return { hall_id: id, from, to, step_start: range.start, step_end: range.end, violations: measuredViolations(getSteps(db, id, first, range.end)) };
  }],

  [/^\/api\/halls\/([^/]+)\/cost$/, (db, [id], q, user) => {
    requireHall(db, id, user);
    const date = requireDate(q, "date");
    const initial = (q.get("initial") ?? "simulated") as InitialStateSource;
    if (initial !== "simulated" && initial !== "measured") throw new BadRequest("'initial' must be 'simulated' or 'measured'");
    const trace = q.get("trace") === "1" || q.get("trace") === "true";
    const names = q.get("schedule") ? [q.get("schedule")!] : listScheduleNames(db, id);
    const results = Object.fromEntries(names.map((n) => [n, dayCost(db, id, n, date, { initial, trace })]));
    const out: Record<string, unknown> = { hall_id: id, date, initial_state_source: initial, schedules: results };
    if (results.baseline && results.optimized) {
      out.savings_eur = results.baseline.cost_eur - results.optimized.cost_eur;
    }
    return out;
  }],
];

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(json)),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(json);
}

const MAX_BODY_BYTES = 16 * 1024;

/** Parses a small JSON request body. Requiring application/json also keeps plain cross-site form posts out. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new BadRequest("expected an application/json body");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BadRequest("request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new BadRequest("body must be a JSON object");
}

/** Failed logins per email: at most MAX_FAILURES within FAILURE_WINDOW_MS. In memory, per process. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, number[]>();

function recentFailures(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

async function login(db: DB, req: IncomingMessage): Promise<{ user: User; token: string }> {
  const body = await readJsonBody(req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) throw new BadRequest("email and password are required");
  const now = Date.now();
  if (recentFailures(email, now).length >= MAX_FAILURES) {
    throw new TooManyRequests("too many failed logins, try again in a few minutes");
  }
  const user = authenticate(db, email, password);
  if (!user) {
    failures.set(email, [...recentFailures(email, now), now]);
    throw new Unauthorized("wrong email or password");
  }
  failures.delete(email);
  return { user, token: createSession(db, user.id) };
}

async function handle(req: IncomingMessage, res: ServerResponse, getDb: () => DB): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  if (path === "/api/health") {
    try {
      getDb().prepare("SELECT 1 FROM sites LIMIT 1").get();
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error("[api] health check failed:", err);
      return send(res, 503, { ok: false, error: DB_UNAVAILABLE });
    }
  }

  if (path === "/api/auth/login") {
    if (method !== "POST") return send(res, 405, { error: "use POST" });
    const { user, token } = await login(getDb(), req);
    return send(res, 200, { user }, { "set-cookie": sessionCookie(token) });
  }
  if (path === "/api/auth/logout") {
    if (method !== "POST") return send(res, 405, { error: "use POST" });
    deleteSession(getDb(), readCookie(req, SESSION_COOKIE));
    return send(res, 200, { ok: true }, { "set-cookie": clearedCookie() });
  }

  const match = routes.map(([re, h]) => [path.match(re), h] as const).find(([m]) => m);
  const postMatch = postRoutes.map(([re, h]) => [path.match(re), h] as const).find(([m]) => m);
  if (!match && !postMatch && path !== "/api/auth/me") return send(res, 404, { error: `no route for ${path}` });
  const isPost = method === "POST" && postMatch;
  if (!isPost && method !== "GET" && method !== "HEAD") {
    return send(res, 405, { error: postMatch ? "use GET or POST" : "only GET is supported" });
  }
  if (!isPost && !match && path !== "/api/auth/me") return send(res, 405, { error: "use POST" });

  const db = getDb();
  const user = sessionUser(db, readCookie(req, SESSION_COOKIE));
  if (!user) throw new Unauthorized("login required");
  if (path === "/api/auth/me") return send(res, 200, { user });

  if (isPost) {
    const body = await readJsonBody(req);
    const params = postMatch[0]!.slice(1).map(decodeURIComponent);
    return send(res, 201, postMatch[1](db, params, body, user));
  }

  const params = match![0]!.slice(1).map(decodeURIComponent);
  send(res, 200, match![1](db, params, url.searchParams, user));
}

/** Returns a request handler; `getDb` is called per request so a missing database yields 503. */
export function createHandler(getDb: () => DB) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res, getDb).catch((err) => {
      if (res.headersSent) return void res.end();
      if (err instanceof Unauthorized) return send(res, 401, { error: err.message });
      if (err instanceof TooManyRequests) return send(res, 429, { error: err.message });
      if (err instanceof Forbidden) return send(res, 403, { error: err.message });
      if (err instanceof NotFound) return send(res, 404, { error: err.message });
      if (err instanceof BadRequest) return send(res, 400, { error: err.message });
      if (err instanceof Conflict) return send(res, 409, { error: err.message });
      if (err instanceof URIError) return send(res, 400, { error: "malformed URL" });
      if (err instanceof MissingDatabase || (err as { code?: string }).code === "ERR_SQLITE_ERROR") {
        console.error("[api] database unavailable:", err);
        return send(res, 503, { error: DB_UNAVAILABLE });
      }
      console.error(err);
      send(res, 500, { error: "internal error" });
    });
  };
}
