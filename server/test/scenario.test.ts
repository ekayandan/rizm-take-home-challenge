/** What maintenance does to a plan, against simulate() on the raw hall files. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate, type Instance, type Schedule } from "../checker/checker.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "hall-scenario-"));
const dbPath = join(tmp, "test.db");
process.env.DB_PATH = dbPath;

const { applyMaintenance, newViolations } = await import("../src/scenario.ts");
const hall = JSON.parse(readFileSync(join(root, "data/halls/halle-7.json"), "utf8")) as Instance & { schedules: Record<string, Schedule> };

let server: Server;
let base = "";
let admin = "", viewer = "", otherSite = "";

const login = async (email: string, password: string) => {
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  return r.headers.get("set-cookie")!.split(";")[0];
};
const get = async (path: string, cookie = admin) => {
  const r = await fetch(base + path, { headers: { cookie } });
  return { status: r.status, body: (await r.json()) as any };
};
const PREVIEW = "/halls/halle-7/consequences?date=2026-10-12&schedule=optimized&asset=boiler&start=2026-10-12T06:00&end=2026-10-12T14:00";

before(async () => {
  execFileSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", join(root, "server/src/seed.ts")], {
    env: { ...process.env, DB_PATH: dbPath },
    stdio: "pipe",
  });
  const { openDb } = await import("../src/db.ts");
  const { createHandler } = await import("../src/app.ts");
  const db = openDb(dbPath);
  server = createServer(createHandler(() => db));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api`;
  admin = await login("jonas.weber@example.com", "admin-2026");
  viewer = await login("petra.koch@example.com", "viewer-2026");
  otherSite = await login("tarek.yilmaz@example.com", "operator-2026");
});

after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const plan: Schedule = { mass_flow_kg_per_s: [5, 5, 5], recirculation: [0.5, 0.5, 0.5], heating_kw: [10, 10, 10], cooling_kw: [2, 2, 2] };
const ts = ["2026-10-08T04:00:00.000Z", "2026-10-08T04:15:00.000Z", "2026-10-08T04:30:00.000Z"];
const win = (asset: "fan" | "boiler" | "chiller", start_utc: string, end_utc: string) => ({ asset, start_utc, end_utc });

test("a window takes the asset away for every step it touches, and only those", () => {
  const out = applyMaintenance(plan, ts, 0.25, [win("boiler", "2026-10-08T04:20:00.000Z", "2026-10-08T04:25:00.000Z")]);
  assert.deepEqual(out.heating_kw, [10, 0, 10]);
  assert.deepEqual(out.cooling_kw, [2, 2, 2]);
  assert.deepEqual(plan.heating_kw, [10, 10, 10], "the stored plan is not changed");
});

test("the window end is exclusive", () => {
  const out = applyMaintenance(plan, ts, 0.25, [win("chiller", "2026-10-08T04:00:00.000Z", "2026-10-08T04:15:00.000Z")]);
  assert.deepEqual(out.cooling_kw, [0, 2, 2]);
});

test("a fan window stops the airflow and both coils", () => {
  const out = applyMaintenance(plan, ts, 0.25, [win("fan", "2026-10-08T04:15:00.000Z", "2026-10-08T04:30:00.000Z")]);
  assert.deepEqual(out.mass_flow_kg_per_s, [5, 0, 5]);
  assert.deepEqual(out.heating_kw, [10, 0, 10]);
  assert.deepEqual(out.cooling_kw, [2, 0, 2]);
  assert.deepEqual(out.recirculation, [0.5, 0.5, 0.5]);
});

test("only violations the stored plan doesn't have count as new", () => {
  const old = { step: 1, constraint: "temp_below_min", value: 1, limit: 2 };
  const fresh = { step: 2, constraint: "temp_below_min", value: 1, limit: 2 };
  assert.deepEqual(newViolations([old], [old, fresh]), [fresh]);
});

test("a preview matches simulate() on the raw file and saves nothing", async () => {
  const before = await get("/halls/halle-7/maintenance");
  const r = await get(PREVIEW);
  assert.equal(r.status, 200);
  assert.equal(r.body.blocked_steps, 32);

  const tsUtc = Array.from({ length: hall.horizon.steps }, (_, k) => new Date(Date.parse((hall as any).start_utc) + k * 900_000).toISOString());
  const after = applyMaintenance(hall.schedules.optimized, tsUtc, hall.horizon.dt_hours, [win("boiler", "2026-10-12T04:00:00.000Z", "2026-10-12T12:00:00.000Z")]);
  const planReport = simulate(hall, hall.schedules.optimized), afterReport = simulate(hall, after);
  assert.equal(r.body.new_violations_total, newViolations(planReport.violations, afterReport.violations).length);
  assert.equal(r.body.still_feasible, r.body.new_violations_total === 0);

  assert.deepEqual((await get("/halls/halle-7/maintenance")).body, before.body);
  assert.ok(Math.abs((await get("/halls/halle-7/cost?date=2026-10-12&schedule=optimized")).body.schedules.optimized.cost_eur - r.body.plan_day.cost_eur) < 1e-9);
});

test("a window before the shown day still changes that day's starting state", async () => {
  const r = await get("/halls/halle-7/consequences?date=2026-10-13&schedule=optimized&asset=boiler&start=2026-10-12T06:00&end=2026-10-12T23:00");
  assert.equal(r.status, 200);
  assert.notEqual(r.body.after_day.initial_state.temperature_c, r.body.plan_day.initial_state.temperature_c);
});

test("a window outside the data period changes nothing", async () => {
  const r = await get("/halls/halle-7/consequences?date=2026-10-12&asset=boiler&start=2027-01-01T06:00&end=2027-01-01T14:00");
  assert.equal(r.body.plan_changed, false);
  assert.equal(r.body.still_feasible, true);
});

test("preview input is checked", async () => {
  const q = "/halls/halle-7/consequences?date=2026-10-12";
  assert.equal((await get(`${q}&asset=roof&start=2026-10-12T06:00&end=2026-10-12T14:00`)).status, 400);
  assert.equal((await get(`${q}&asset=boiler&start=2026-10-12T06:00`)).status, 400);
  assert.equal((await get(`${q}&asset=boiler&start=2026-10-12T14:00&end=2026-10-12T06:00`)).status, 400);
  assert.equal((await get("/halls/halle-7/consequences?date=2030-01-01")).status, 400);
  assert.equal((await get("/halls/halle-7/consequences?date=2026-10-12&schedule=nope")).status, 404);
});

test("viewers can preview on their site; other sites look missing", async () => {
  assert.equal((await get(PREVIEW, viewer)).status, 200);
  assert.equal((await get(PREVIEW, otherSite)).status, 404);
});

test("a saved window is in force, and the preview adds to it", async () => {
  const none = await get("/halls/halle-3/consequences?date=2026-10-08");
  assert.deepEqual(none.body.windows, []);
  assert.equal(none.body.plan_changed, false);
  const save = await fetch(`${base}/halls/halle-3/maintenance`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({ asset: "boiler", start: "2026-10-08T06:00", end: "2026-10-08T14:00", reason: "test" }),
  });
  assert.equal(save.status, 201);
  const inForce = await get("/halls/halle-3/consequences?date=2026-10-08");
  assert.equal(inForce.body.windows.length, 1);
  assert.equal(inForce.body.plan_changed, true);
  const both = await get("/halls/halle-3/consequences?date=2026-10-08&asset=fan&start=2026-10-08T15:00&end=2026-10-08T16:00");
  assert.equal(both.body.windows.length, 2);
});
