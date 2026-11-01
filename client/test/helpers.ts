/** Shared helpers for the issue 7 tests: a scripted fetch, and fixtures for one hall and day. */
import { vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent } from "vue";

type Reply = { status?: number; body?: unknown; text?: string } | "network-error" | "hang";
export type Script = Record<string, Reply | Reply[] | ((url: string) => Reply)>;

/**
 * Stubs fetch. Keys are "METHOD /path" matched against the URL without /api and query, and the
 * longest match wins. An array is played in order, repeating its last entry. "hang" settles only
 * when the request's signal aborts.
 */
export function stubFetch(script: Script) {
  const calls: { method: string; url: string }[] = [];
  const played = new Map<string, number>();
  const fn = vi.fn((input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input).replace(/^\/api/, "");
    calls.push({ method, url });
    const path = url.split("?")[0];
    const key = Object.keys(script).filter((k) => k === `${method} ${path}`)[0];
    if (!key) return Promise.resolve(new Response(JSON.stringify({ error: `unscripted ${method} ${url}` }), { status: 404 }));
    const entry = script[key];
    let reply: Reply;
    if (Array.isArray(entry)) {
      const i = played.get(key) ?? 0;
      played.set(key, i + 1);
      reply = entry[Math.min(i, entry.length - 1)];
    } else {
      reply = typeof entry === "function" ? entry(url) : entry;
    }
    if (reply === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
    if (reply === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    const body = reply.text ?? JSON.stringify(reply.body ?? {});
    return Promise.resolve(new Response(body, { status: reply.status ?? 200 }));
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

/** What Vite's proxy answers while the API is down. */
export const BAD_GATEWAY: Reply = { status: 502, text: "" };

export const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const Stub = defineComponent({ template: "<div />" });
export const testRouter = (initial: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: Stub },
      { path: "/login", name: "login", component: Stub },
      { path: "/halls/:hallId", name: "hall", component: Stub },
      { path: "/halls/:hallId/days/:date", name: "hall-day", component: Stub },
    ],
  });
  router.push(initial);
  return router;
};

export const hallDetail = (over: Record<string, unknown> = {}) => ({
  id: "halle-a", site_id: "suedwerk", name: "Halle A", notes: "Assembly hall", timezone: "Europe/Berlin",
  start_utc: "2026-10-04T22:00:00Z", dt_minutes: 15, horizon: { steps: 192, dt_hours: 0.25 },
  first_date: "2026-10-05", last_date: "2026-10-07",
  days: [
    { date: "2026-10-05", step_start: 0, step_end: 96, steps: 96 },
    { date: "2026-10-07", step_start: 192, step_end: 288, steps: 96 },
  ],
  room: {}, hvac: { max_mass_flow_kg_per_s: 1, max_recirculation: 1 },
  schedules: ["baseline", "optimized"],
  ...over,
});

const pair = [1, 1];
export const dayReport = (schedule: string) => ({
  schedule, feasible: true, cost_eur: 10, cost_breakdown_eur: { fan: 5, heating: 3, cooling: 2 },
  energy_kwh: { fan: 1, heating: 1, cooling: 1, total: 3 }, n_violations: 0, steps: 2,
  date: "2026-10-05", step_start: 0, step_end: 2, violations: [],
  trace: { temperature_c: [20, 20, 20], co2_ppm: [500, 500, 500], t_sup_c: [20, 20, 20], p_el_kw: pair, cost_eur: pair },
});

export const daySeries = (temperature: (number | null)[], co2: (number | null)[]) => ({
  hall_id: "halle-a", from: "2026-10-05", to: "2026-10-05", step_start: 0, step_end: 2, steps: 2, dt_minutes: 15,
  ts_utc: ["2026-10-04T22:00:00Z", "2026-10-04T22:15:00Z"],
  local_time: ["2026-10-05T00:00+02:00", "2026-10-05T00:15+02:00"],
  series: { price_eur_per_mwh: pair, outdoor_temp_c: pair, internal_heat_kw: pair, co2_generation_m3_per_h: pair, occupancy_persons: pair },
  schedules: Object.fromEntries(["baseline", "optimized"].map((n) => [n, { mass_flow_kg_per_s: pair, recirculation: pair, heating_kw: pair, cooling_kw: pair }])),
  state_ts_utc: ["a", "b", "c"],
  bounds: { temp_min_c: [18, 18, 18], temp_max_c: [24, 24, 24], co2_max_ppm: [1000, 1000, 1000] },
  measured: { temperature_c: temperature, co2_ppm: co2 },
});

export const siteOf = (halls: unknown[], over: Record<string, unknown> = {}) => ({
  id: "suedwerk", name: "Südwerk", city: "Kempten", timezone: "Europe/Berlin",
  first_date: "2026-10-05", last_date: "2026-10-07", halls, ...over,
});
export const siteHall = (over: Record<string, unknown> = {}) => ({
  id: "halle-a", site_id: "suedwerk", name: "Halle A", notes: null, timezone: "Europe/Berlin",
  first_date: "2026-10-05", last_date: "2026-10-07", shifts: null,
  days: [{ date: "2026-10-05", steps: 96 }, { date: "2026-10-07", steps: 96 }],
  ...over,
});
