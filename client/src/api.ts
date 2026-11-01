/** Thin typed client for the JSON API (proxied to the Node server by Vite). */
import type { MeasuredViolation } from "./violations";
import { perfLog } from "./perf";

export interface HallSummary { id: string; site_id: string; name: string; notes: string | null; timezone: string }
/** Weekdays count from 0 = Monday; start and end are local wall-clock times. */
export interface Shift { weekdays: number[]; start: string; end: string }
export interface SiteHall extends HallSummary { first_date: string | null; last_date: string | null; shifts: Shift[] | null; days: { date: string; steps: number }[] }
export interface Site {
  id: string;
  name: string;
  city: string;
  timezone: string;
  first_date: string | null;
  last_date: string | null;
  halls: SiteHall[];
}
/** Steps in an ordinary day: 24 hours at 15 minutes. Clock-change days and gaps differ. */
export const NORMAL_DAY_STEPS = 96;
export interface Day { date: string; step_start: number; step_end: number; steps: number }
export interface HallDetail extends HallSummary {
  start_utc: string;
  dt_minutes: number;
  horizon: { steps: number; dt_hours: number };
  first_date: string | null;
  last_date: string | null;
  days: Day[];
  room: Record<string, number>;
  hvac: Record<string, number>;
  schedules: string[];
}
export interface DayCostReport {
  schedule: string;
  feasible: boolean;
  cost_eur: number;
  cost_breakdown_eur: { fan: number; heating: number; cooling: number };
  energy_kwh: { fan: number; heating: number; cooling: number; total: number };
  n_violations: number;
  steps: number;
}
export interface Violation { step: number; constraint: string; value: number | number[]; limit: number | number[]; ts_utc: string }
export type { MeasuredViolation };
export interface HallViolations { step_start: number; step_end: number; violations: MeasuredViolation[] }
export interface Trace {
  /** N+1 state points: start of each step plus the end of the day. */
  temperature_c: number[];
  co2_ppm: number[];
  t_sup_c: (number | null)[];
  p_el_kw: number[];
  cost_eur: number[];
}
/** One schedule's day report with the simulated state trajectory (cost?schedule=&trace=1). */
export interface DayCostTraced extends DayCostReport {
  date: string;
  step_start: number;
  step_end: number;
  violations: Violation[];
  trace: Trace;
}
export interface NewViolationGroup {
  constraint: string;
  count: number;
  worst: number;
  first_local: string;
  last_local: string;
}
/** A schedule with maintenance blocked and nothing re-planned, against the stored schedule. */
export interface Consequences {
  hall_id: string;
  schedule: string;
  date: string;
  windows: { asset: Asset; start_utc: string; end_utc: string }[];
  blocked_steps: number;
  changed_steps: number;
  plan_changed: boolean;
  still_feasible: boolean;
  new_violations: NewViolationGroup[];
  new_violations_total: number;
  new_violations_on_day: number;
  plan_day: DayCostTraced;
  after_day: DayCostTraced;
  after_controls: ScheduleSeries;
}
export interface ProposedWindow { asset: Asset; start: string; end: string }
export interface ScheduleSeries {
  mass_flow_kg_per_s: number[];
  recirculation: number[];
  heating_kw: number[];
  cooling_kw: number[];
}
export interface HallSeries {
  hall_id: string;
  from: string;
  to: string;
  step_start: number;
  step_end: number;
  steps: number;
  dt_minutes: number;
  ts_utc: string[];
  /** Local wall-clock time with offset, e.g. 2026-10-06T06:15+02:00. */
  local_time: string[];
  series: {
    price_eur_per_mwh: number[];
    outdoor_temp_c: number[];
    internal_heat_kw: number[];
    co2_generation_m3_per_h: number[];
    occupancy_persons: (number | null)[];
  };
  schedules: Record<string, ScheduleSeries>;
  state_ts_utc: string[];
  bounds: { temp_min_c: number[]; temp_max_c: number[]; co2_max_ppm: number[] };
  measured: { temperature_c: (number | null)[]; co2_ppm: (number | null)[] };
}

export interface DayCost {
  hall_id: string;
  date: string;
  schedules: Record<string, DayCostReport>;
  savings_eur?: number;
}

export interface SiteHallCost {
  hall_id: string;
  name: string;
  cost_eur: number | null;
  /** Why cost_eur is null (no data that day, no such schedule). */
  reason?: string;
  energy_kwh?: { fan: number; heating: number; cooling: number; total: number };
  feasible?: boolean;
  n_violations?: number;
}
export interface SiteDayCost {
  site_id: string;
  date: string;
  schedule: string;
  total_cost_eur: number | null;
  complete: boolean;
  halls: SiteHallCost[];
}

export const ASSETS = ["fan", "boiler", "chiller"] as const;
export type Asset = (typeof ASSETS)[number];
/** An asset of a hall is unavailable from start (inclusive) to end (exclusive). */
export interface MaintenanceWindow {
  id: number;
  hall_id: string;
  asset: Asset;
  start_utc: string;
  end_utc: string;
  /** Hall-local wall-clock time with offset, e.g. 2026-10-06T08:00+02:00. */
  start_local: string;
  end_local: string;
  reason: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
}
/** start and end are hall-local wall-clock times, YYYY-MM-DDTHH:MM. */
export interface NewMaintenanceWindow { asset: Asset; start: string; end: string; reason: string }
/** One entry of the history. Instants are UTC; timezone is the hall's. */
export interface Intervention {
  id: number;
  type: string;
  site_name: string;
  hall_name: string;
  timezone: string;
  reason: string;
  created_by_name: string;
  created_at: string;
  revoked_at: string | null;
  revoked_by_name: string | null;
  revoke_reason: string | null;
  asset: Asset;
  start_utc: string;
  end_utc: string;
}

export type Role = "admin" | "operator" | "viewer";
export interface User { id: string; name: string; email: string; role: Role; sites: string[] }

/** Thrown for 401 responses; the session is missing or expired. */
export class Unauthorized extends Error {}

/** The server answered with an error other than 401. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** No answer arrived, so a write may or may not have reached the server. */
export class ConnectionError extends Error {}

/** True if a failed save may have been stored anyway: no answer, or the server failed part way. */
export const outcomeUnknown = (e: unknown) => e instanceof ConnectionError || (e instanceof ApiError && e.status >= 500);

const REQUEST_TIMEOUT_MS = 30_000;

/** Plain words for an error status; a 4xx keeps the server's own explanation. */
function errorMessage(status: number, serverMessage?: string): string {
  if (status === 502 || status === 503 || status === 504) return "The service is not available right now. Try again in a moment.";
  if (status >= 500) return "Something went wrong on the server. Try again in a moment.";
  return serverMessage ?? "The request could not be completed.";
}

let onUnauthorized: () => void = () => {};
/** Called whenever a data request answers 401 (e.g. the session expired). */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  let body: { error?: string };
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: data === undefined ? undefined : { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller.signal,
    });
    const received = performance.now();
    body = await res.json().catch(() => ({}));
    perfLog(`${method} ${path}`, performance.now() - start, `parse ${(performance.now() - received).toFixed(1)} ms`);
  } catch {
    throw new ConnectionError(
      controller.signal.aborted
        ? "The server took too long to answer. Try again in a moment."
        : "We can't reach the server. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw new Unauthorized(body.error ?? "login required");
  if (!res.ok) throw new ApiError(errorMessage(res.status, body.error), res.status);
  return body as T;
}

async function get<T>(path: string): Promise<T> {
  return withSessionCheck(request<T>("GET", path));
}

async function post<T>(path: string, data: unknown): Promise<T> {
  return withSessionCheck(request<T>("POST", path, data));
}

async function withSessionCheck<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof Unauthorized) onUnauthorized();
    throw e;
  }
}

export const authApi = {
  me: async () => (await request<{ user: User }>("GET", "/auth/me")).user,
  login: async (email: string, password: string) =>
    (await request<{ user: User }>("POST", "/auth/login", { email, password })).user,
  logout: () => request<{ ok: true }>("POST", "/auth/logout", {}),
};

export const api = {
  sites: () => get<Site[]>("/sites"),
  hall: (id: string) => get<HallDetail>(`/halls/${encodeURIComponent(id)}`),
  dayCost: (id: string, date: string) => get<DayCost>(`/halls/${encodeURIComponent(id)}/cost?date=${date}`),
  series: (id: string, date: string) =>
    get<HallSeries>(`/halls/${encodeURIComponent(id)}/series?from=${date}&to=${date}`),
  seriesRange: (id: string, from: string, to: string) =>
    get<HallSeries>(`/halls/${encodeURIComponent(id)}/series?from=${from}&to=${to}`),
  violationsRange: (id: string, from: string, to: string) =>
    get<HallViolations>(`/halls/${encodeURIComponent(id)}/violations?from=${from}&to=${to}`),
  scheduleDayCost: async (id: string, date: string, schedule: string) => {
    const r = await get<{ schedules: Record<string, DayCostTraced> }>(
      `/halls/${encodeURIComponent(id)}/cost?date=${date}&schedule=${encodeURIComponent(schedule)}&trace=1`,
    );
    return r.schedules[schedule];
  },
  violations: (id: string, date: string) =>
    get<HallViolations>(`/halls/${encodeURIComponent(id)}/violations?from=${date}&to=${date}`),
  maintenance: (id: string) => get<MaintenanceWindow[]>(`/halls/${encodeURIComponent(id)}/maintenance`),
  addMaintenance: (id: string, w: NewMaintenanceWindow) =>
    post<MaintenanceWindow>(`/halls/${encodeURIComponent(id)}/maintenance`, w),
  consequences: (id: string, date: string, schedule: string, proposed?: ProposedWindow) => {
    const q = new URLSearchParams({ date, schedule, ...proposed });
    return get<Consequences>(`/halls/${encodeURIComponent(id)}/consequences?${q}`);
  },
  interventions: () => get<Intervention[]>("/interventions"),
  siteDayCost: (id: string, date: string) =>
    get<SiteDayCost>(`/sites/${encodeURIComponent(id)}/cost?date=${date}&schedule=optimized`),
};
