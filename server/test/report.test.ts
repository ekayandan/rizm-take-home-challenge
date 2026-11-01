/** Checks the weekly report against simulate() on the raw hall files, through the API. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate, type Instance, type Schedule } from "../checker/checker.ts";
import { applyMaintenance, reportCsv, type WeeklyReport } from "../src/report.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "hall-report-"));
const dbPath = join(tmp, "test.db");
process.env.DB_PATH = dbPath;

type HallFile = Instance & { id: string; schedules: Record<string, Schedule> };
const hallFile = (id: string) => JSON.parse(readFileSync(join(root, "data", "halls", `${id}.json`), "utf8")) as HallFile;

const CLOCK_CHANGE_WEEK = "2026-10-19";
let server: Server;
let base = "";
let admin = "";
let db: any;

const login = async (email: string, password: string) => {
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  return r.headers.get("set-cookie")!.split(";")[0];
};
const report = async (site: string, week: string, cookie = admin) => {
  const r = await fetch(`${base}/sites/${site}/weekly-report?week=${week}`, { headers: { cookie } });
  return { status: r.status, body: (await r.json()) as any };
};
const stepsOf = (hall: string, week: string): { step: number; ts_utc: string }[] => db
  .prepare("SELECT step, ts_utc FROM hall_steps WHERE hall_id = ? AND local_date BETWEEN ? AND date(?, '+6 days') AND price_eur_per_mwh IS NOT NULL ORDER BY step")
  .all(hall, week, week);

before(async () => {
  execFileSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", join(root, "server/src/seed.ts")], { env: { ...process.env, DB_PATH: dbPath }, stdio: "pipe" });
  const { openDb } = await import("../src/db.ts");
  const { createHandler } = await import("../src/app.ts");
  db = openDb(dbPath);
  server = createServer(createHandler(() => db));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api`;
  admin = await login("jonas.weber@example.com", "admin-2026");
});

after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const expectedCost = (h: HallFile, schedule: Schedule, steps: { step: number }[]) => {
  const costs = simulate(h, schedule, { trace: true }).trace!.cost_eur;
  return steps.reduce((a, s) => a + costs[s.step], 0);
};

test("costs match simulate() and the clock-change week has 169 hours", async () => {
  const { status, body } = await report("nordwerk", CLOCK_CHANGE_WEEK);
  assert.equal(status, 200);
  assert.equal(body.week.end, "2026-10-25");
  assert.equal(body.week.partial, false);
  assert.deepEqual(body.halls.map((h: any) => h.hall_id).sort(), ["halle-3", "halle-7"]);
  for (const hall of body.halls) {
    const file = hallFile(hall.hall_id);
    const steps = stepsOf(hall.hall_id, CLOCK_CHANGE_WEEK);
    assert.equal(hall.hours_covered, 169);
    assert.ok(Math.abs(hall.baseline_eur - expectedCost(file, file.schedules.baseline, steps)) < 1e-6);
    assert.ok(Math.abs(hall.optimized_eur - expectedCost(file, file.schedules.optimized, steps)) < 1e-6);
    assert.equal(hall.post_intervention_eur, hall.optimized_eur);
    assert.ok(Math.abs(hall.savings_eur - (hall.baseline_eur - hall.optimized_eur)) < 1e-9);
  }
  assert.ok(Math.abs(body.summary.optimized_eur - body.halls[0].optimized_eur - body.halls[1].optimized_eur) < 1e-9);
});

test("each week's out-of-bounds hours count an interval once and add up across the data", async () => {
  const weeks = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"];
  let total = 0;
  for (const week of weeks) total += (await report("suedwerk", week)).body.halls[0].hours_out_of_bounds;
  const rows: any = db.prepare(
    `SELECT COUNT(*) AS n FROM hall_steps WHERE hall_id = 'halle-a' AND step <= (SELECT MAX(step) FROM hall_steps WHERE hall_id = 'halle-a') AND (
       measured_temperature_c < temp_min_c - 1e-6 OR measured_temperature_c > temp_max_c + 1e-6 OR measured_co2_ppm > co2_max_ppm + 1e-6)`,
  ).get();
  assert.equal(total, rows.n * 0.25);
});

test("top intervals are the costliest of the post-intervention plan, across halls on the summary", async () => {
  const { body } = await report("nordwerk", "2026-10-12");
  const all = body.halls.flatMap((h: any) => h.top_intervals).sort((a: any, b: any) => b.cost_eur - a.cost_eur);
  assert.equal(body.summary.top_intervals.length, 3);
  assert.deepEqual(body.summary.top_intervals.map((i: any) => i.cost_eur), all.slice(0, 3).map((i: any) => i.cost_eur));
  for (const hall of body.halls) {
    const file = hallFile(hall.hall_id);
    const costs = simulate(file, file.schedules.optimized, { trace: true }).trace!.cost_eur;
    const best = stepsOf(hall.hall_id, "2026-10-12").map((s) => costs[s.step]).sort((a, b) => b - a).slice(0, 3);
    assert.deepEqual(hall.top_intervals.map((i: any) => i.cost_eur), best);
  }
});

test("an interval in the repeated clock-change hour says which occurrence it is", async () => {
  const rows = db.prepare("SELECT step, price_eur_per_mwh AS price FROM hall_steps WHERE hall_id = 'halle-a' AND local_date = '2026-10-25' AND local_time = '02:30' ORDER BY step").all();
  assert.equal(rows.length, 2);
  const update = db.prepare("UPDATE hall_steps SET price_eur_per_mwh = ? WHERE hall_id = 'halle-a' AND step = ?");
  const flow = db.prepare("UPDATE schedule_steps SET mass_flow_kg_per_s = ? WHERE hall_id = 'halle-a' AND schedule_name = 'optimized' AND step = ?");
  for (const r of rows) {
    update.run(1e6, r.step);
    flow.run(1, r.step);
  }
  const { body } = await report("suedwerk", CLOCK_CHANGE_WEEK);
  for (const r of rows) {
    update.run(r.price, r.step);
    flow.run(0, r.step);
  }
  const times = body.summary.top_intervals.map((i: any) => i.local_time).sort();
  assert.deepEqual(times.slice(0, 2), ["02:30 (first, CEST)", "02:30 (second, CET)"]);
});

test("a partial week says so and only counts the days with data", async () => {
  const { body } = await report("nordwerk", "2026-11-02");
  assert.equal(body.week.partial, true);
  assert.equal(body.halls[0].to, "2026-11-03");
  assert.equal(body.halls[0].hours_covered, 48);
});

test("the post-intervention cost applies windows in force, and stops counting a revoked one", async () => {
  const cookie = admin;
  const before = (await report("suedwerk", "2026-10-05")).body.halls[0];
  const r = await fetch(`${base}/halls/halle-a/maintenance`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ asset: "fan", start: "2026-10-05T00:00", end: "2026-10-12T00:00", reason: "Test" }),
  });
  assert.equal(r.status, 201);
  const { id } = (await r.json()) as any;
  const during = (await report("suedwerk", "2026-10-05")).body.halls[0];
  assert.equal(during.post_intervention_eur, 0);
  assert.ok(during.intervention_limit_hours > 0, "stopping the fan breaks limits the plan otherwise keeps");
  assert.equal(before.intervention_limit_hours, 0);
  const flagged = (await report("suedwerk", "2026-10-05")).body;
  assert.match(flagged.notes[0], /^Savings are overstated/);
  assert.equal(flagged.summary.intervention_limit_hours, during.intervention_limit_hours);
  const csv = await (await fetch(`${base}/sites/suedwerk/weekly-report.csv?week=2026-10-05`, { headers: { cookie } })).text();
  assert.ok(csv.includes("Note;Savings are overstated"));
  assert.equal(during.optimized_eur, before.optimized_eur);
  assert.equal(during.interventions, 1);
  assert.equal((await report("suedwerk", "2026-10-12")).body.halls[0].interventions, 0, "the window ends as that week starts");

  db.prepare("UPDATE interventions SET revoked_at = ?, revoked_by = 'x', revoked_by_name = 'x', revoke_reason = 'x' WHERE id = ?").run(new Date().toISOString(), id);
  const afterRevoke = (await report("suedwerk", "2026-10-05")).body.halls[0];
  assert.equal(afterRevoke.post_intervention_eur, before.post_intervention_eur);
  assert.equal(afterRevoke.intervention_limit_hours, 0);
  assert.doesNotMatch((await report("suedwerk", "2026-10-05")).body.notes[0], /overstated/);
});

test("a boiler window that leaves the hall too cold is flagged, in the week it hits only", async () => {
  const added = await fetch(`${base}/halls/halle-3/maintenance`, {
    method: "POST", headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({ asset: "boiler", start: "2026-10-26T00:00", end: "2026-10-30T00:00", reason: "Test" }),
  });
  const { id } = (await added.json()) as any;
  const hit = (await report("nordwerk", "2026-10-26")).body.halls.find((h: any) => h.hall_id === "halle-3");
  const earlier = (await report("nordwerk", "2026-10-19")).body.halls.find((h: any) => h.hall_id === "halle-3");
  db.prepare("UPDATE interventions SET revoked_at = ?, revoked_by = 'x', revoked_by_name = 'x', revoke_reason = 'x' WHERE id = ?").run(new Date().toISOString(), id);
  assert.ok(hit.post_intervention_eur < hit.optimized_eur);
  assert.ok(hit.intervention_limit_hours > 0);
  assert.equal(earlier.intervention_limit_hours, 0);
});

test("applyMaintenance zeroes only the blocked asset, in every step a window touches", () => {
  const s: Schedule = { mass_flow_kg_per_s: [1, 1, 1], recirculation: [0.5, 0.5, 0.5], heating_kw: [2, 2, 2], cooling_kw: [3, 3, 3] };
  const ts = ["2026-10-05T00:00:00.000Z", "2026-10-05T00:15:00.000Z", "2026-10-05T00:30:00.000Z"];
  const window = (asset: "fan" | "boiler" | "chiller") => [{ asset, start_utc: "2026-10-05T00:20:00.000Z", end_utc: "2026-10-05T00:30:00.000Z" }];
  assert.deepEqual(applyMaintenance(s, ts, 0.25, window("boiler")).heating_kw, [2, 0, 2]);
  assert.deepEqual(applyMaintenance(s, ts, 0.25, window("boiler")).cooling_kw, [3, 3, 3]);
  assert.deepEqual(applyMaintenance(s, ts, 0.25, window("chiller")).cooling_kw, [3, 0, 3]);
  const fan = applyMaintenance(s, ts, 0.25, window("fan"));
  assert.deepEqual([fan.mass_flow_kg_per_s, fan.heating_kw, fan.cooling_kw], [[1, 0, 1], [2, 0, 2], [3, 0, 3]]);
  assert.deepEqual(s.heating_kw, [2, 2, 2], "the input is untouched");
});

test("access follows the site: other sites look missing, viewers can read", async () => {
  const viewer = await login("petra.koch@example.com", "viewer-2026");
  assert.equal((await report("nordwerk", "2026-10-12", viewer)).status, 200);
  assert.equal((await report("suedwerk", "2026-10-12", viewer)).status, 404);
  const csv = await fetch(`${base}/sites/suedwerk/weekly-report.csv?week=2026-10-12`, { headers: { cookie: viewer } });
  assert.equal(csv.status, 404);
  assert.equal((await fetch(`${base}/sites/nordwerk/weekly-report.csv?week=2026-10-12`)).status, 401);
});

test("the week must be a Monday with data", async () => {
  assert.equal((await report("nordwerk", "2026-10-13")).status, 400);
  assert.equal((await report("nordwerk", "2025-10-13")).status, 400);
  assert.equal((await report("nordwerk", "nonsense")).status, 400);
});

test("the CSV download opens in German Excel and follows the report's order", async () => {
  const r = await fetch(`${base}/sites/nordwerk/weekly-report.csv?week=${CLOCK_CHANGE_WEEK}`, { headers: { cookie: admin } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type")!, /text\/csv/);
  assert.match(r.headers.get("content-disposition")!, /weekly-report-nordwerk-2026-10-19\.csv/);
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1).split("\r\n");
  assert.equal(lines[0], "Weekly report;Nordwerk Stade");
  assert.ok(lines.some((l) => l.startsWith("Note;Cost after interventions") && l.includes("nothing else re-planned")));
  assert.ok(lines.some((l) => l.startsWith("Note;") && l.includes("hall")));
  const blocks = lines.filter((l) => l === "Site summary" || l.startsWith("Hall;Halle"));
  assert.deepEqual(blocks, ["Site summary", "Hall;Halle 3 Montage", "Hall;Halle 7 Endmontage"]);
  const { body } = await report("nordwerk", CLOCK_CHANGE_WEEK);
  assert.ok(lines.some((l) => l.startsWith("Total;") && l.includes(body.summary.baseline_eur.toFixed(2).replace(".", ","))));
});

test("the CSV escapes text and leaves unknown figures empty", () => {
  const figures = { baseline_eur: null, optimized_eur: 1.5, post_intervention_eur: 1.5, savings_eur: null, intervention_limit_hours: 0, hours_out_of_bounds: 0.25, hours_covered: 1, hours_without_price: 0, interventions: 0, top_intervals: [] };
  const r: WeeklyReport = {
    site: { id: "s", name: 'A;"B"', city: "C" },
    week: { start: "2026-10-05", end: "2026-10-11", partial: true },
    notes: ["A note"],
    summary: figures,
    halls: [{ ...figures, hall_id: "h", name: "=cmd()", from: null, to: null }],
  };
  const csv = reportCsv(r);
  assert.ok(csv.includes('Weekly report;"A;""B"""'));
  assert.ok(csv.includes("Partial week"));
  assert.ok(csv.includes("'=cmd();;1,50;1,50;;0,25;1,00;0,00;0"));
});
