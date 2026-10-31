/**
 * Seeds a temporary database from data/ and checks the API against simulate() on the raw files.
 *   node --experimental-strip-types --experimental-sqlite --test server/test/api.test.ts (or npm test)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate, TOL, type Instance, type Schedule } from "../checker/checker.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "hall-api-"));
const dbPath = join(tmp, "test.db");
process.env.DB_PATH = dbPath;

const halls = readdirSync(join(root, "data", "halls"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(root, "data", "halls", f), "utf8")) as Instance & { id: string; schedules: Record<string, Schedule> });

let server: Server;
let base = "";
let adminCookie = "";

const post = (path: string, body: unknown, cookie = "") =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

/** Logs in and returns the session cookie ("name=value"). */
const login = async (email: string, password: string) => {
  const r = await post("/auth/login", { email, password });
  assert.equal(r.status, 200, `login ${email}`);
  return r.headers.get("set-cookie")!.split(";")[0];
};

const get = async (path: string, cookie = adminCookie) => {
  const r = await fetch(base + path, { headers: { cookie } });
  return { status: r.status, body: (await r.json()) as any };
};

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
  adminCookie = await login("jonas.weber@example.com", "admin-2026");
});

after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("lists sites with their halls", async () => {
  const { status, body } = await get("/sites");
  assert.equal(status, 200);
  assert.deepEqual(body.map((s: any) => s.id).sort(), ["nordwerk", "suedwerk"]);
  assert.equal(body.flatMap((s: any) => s.halls).length, 3);
});

test("site halls list their shifts, and the notes no longer repeat them", async () => {
  const { body } = await get("/sites");
  for (const hall of body.flatMap((s: any) => s.halls)) {
    assert.deepEqual(hall.shifts, [
      { weekdays: [0, 1, 2, 3, 4], start: "06:00", end: "14:00" },
      { weekdays: [0, 1, 2, 3, 4], start: "14:00", end: "22:00" },
    ]);
    assert.doesNotMatch(hall.notes, /shift/i);
  }
});

test("site halls list their days with step counts", async () => {
  const { body } = await get("/sites");
  for (const hall of body.flatMap((s: any) => s.halls)) {
    assert.equal(hall.days.length, 30);
    assert.deepEqual(hall.days.find((d: any) => d.date === "2026-10-25"), { date: "2026-10-25", steps: 100 });
  }
});

test("hall detail covers 30 local days, the DST day has 100 steps", async () => {
  const { body } = await get("/halls/halle-3");
  assert.equal(body.days.length, 30);
  assert.equal(body.days.reduce((a: number, d: any) => a + d.steps, 0), 2884);
  assert.equal(body.days.find((d: any) => d.date === "2026-10-25").steps, 100);
});

test("series for a range matches the hall file", async () => {
  const h = halls.find((x) => x.id === "halle-a")!;
  const { body } = await get("/halls/halle-a/series?from=2026-10-06&to=2026-10-07");
  assert.equal(body.steps, 192);
  const k0 = body.step_start;
  assert.deepEqual(body.series.price_eur_per_mwh, h.series.price_eur_per_mwh.slice(k0, k0 + 192));
  assert.deepEqual(body.bounds.co2_max_ppm, h.bounds.co2_max_ppm.slice(k0, k0 + 193));
  assert.deepEqual(body.schedules.optimized.heating_kw, h.schedules.optimized.heating_kw.slice(k0, k0 + 192));
});

test("day costs add up to the full-horizon simulate() cost", async () => {
  for (const h of halls) {
    const { body: hall } = await get(`/halls/${h.id}`);
    const totals: Record<string, number> = {};
    for (const d of hall.days) {
      const { status, body } = await get(`/halls/${h.id}/cost?date=${d.date}`);
      assert.equal(status, 200);
      for (const [name, r] of Object.entries<any>(body.schedules)) totals[name] = (totals[name] ?? 0) + r.cost_eur;
    }
    for (const [name, sched] of Object.entries(h.schedules)) {
      const full = simulate(h, sched);
      assert.ok(Math.abs(totals[name] - full.cost_eur) < 1e-6, `${h.id}/${name}: ${totals[name]} vs ${full.cost_eur}`);
    }
  }
});

test("site day cost sums the optimized cost of its halls", async () => {
  const { body: sites } = await get("/sites");
  const nord = sites.find((s: any) => s.id === "nordwerk");
  assert.equal(nord.first_date, "2026-10-05");
  const { status, body } = await get(`/sites/nordwerk/cost?date=${nord.first_date}`);
  assert.equal(status, 200);
  assert.equal(body.schedule, "optimized");
  assert.equal(body.complete, true);
  assert.deepEqual(body.halls.map((h: any) => h.hall_id).sort(), ["halle-3", "halle-7"]);
  let sum = 0;
  for (const h of body.halls) {
    const { body: hc } = await get(`/halls/${h.hall_id}/cost?date=${nord.first_date}&schedule=optimized`);
    assert.ok(Math.abs(h.cost_eur - hc.schedules.optimized.cost_eur) < 1e-9);
    sum += h.cost_eur;
  }
  assert.ok(Math.abs(body.total_cost_eur - sum) < 1e-9);

  const out = await get("/sites/nordwerk/cost?date=2027-01-01");
  assert.equal(out.status, 200);
  assert.equal(out.body.total_cost_eur, null);
  assert.equal(out.body.complete, false);
});

test("errors", async () => {
  assert.equal((await get("/halls/nope")).status, 404);
  assert.equal((await get("/halls/halle-3/cost")).status, 400);
  assert.equal((await get("/halls/halle-3/cost?date=2027-01-01")).status, 400);
  assert.equal((await get("/halls/halle-3/cost?date=2026-10-06&schedule=nope")).status, 404);
  assert.equal((await get("/sites/nope/cost?date=2026-10-06")).status, 404);
  assert.equal((await get("/sites/nordwerk/cost")).status, 400);
});

test("API needs a login; health does not", async () => {
  assert.equal((await get("/health", "")).status, 200);
  for (const path of ["/sites", "/halls", "/halls/halle-3", "/sites/nordwerk/cost?date=2026-10-06", "/auth/me"]) {
    assert.equal((await get(path, "")).status, 401, path);
    assert.equal((await get(path, "hvac_session=forged")).status, 401, path);
  }
});

test("login checks the password and stores only hashes", async () => {
  assert.equal((await post("/auth/login", { email: "jonas.weber@example.com", password: "wrong" })).status, 401);
  assert.equal((await post("/auth/login", { email: "nobody@example.com", password: "admin-2026" })).status, 401);
  assert.equal((await post("/auth/login", { email: "jonas.weber@example.com" })).status, 400);
  const r = await post("/auth/login", { email: " Jonas.Weber@example.com ", password: "admin-2026" });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const body = (await r.json()) as any;
  assert.equal(body.user.role, "admin");
  assert.equal(body.user.password_hash, undefined);

  const { openDb } = await import("../src/db.ts");
  const db = openDb(dbPath);
  const hashes = db.prepare("SELECT password_hash FROM users").all() as { password_hash: string }[];
  db.close();
  assert.equal(hashes.length, 4);
  for (const h of hashes) assert.match(h.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
});

test("me and logout", async () => {
  const cookie = await login("lena.hartmann@example.com", "operator-2026");
  const me = await get("/auth/me", cookie);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "lena.hartmann@example.com");
  assert.deepEqual(me.body.user.sites, ["nordwerk"]);
  const out = await post("/auth/logout", {}, cookie);
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal((await get("/auth/me", cookie)).status, 401);
  assert.equal((await get("/sites", cookie)).status, 401);
});

test("users only see their assigned sites", async () => {
  const cookie = await login("tarek.yilmaz@example.com", "operator-2026");
  const sites = await get("/sites", cookie);
  assert.deepEqual(sites.body.map((s: any) => s.id), ["suedwerk"]);
  assert.deepEqual((await get("/halls", cookie)).body.map((h: any) => h.id), ["halle-a"]);
  assert.equal((await get("/halls/halle-a", cookie)).status, 200);
  assert.equal((await get("/halls/halle-3", cookie)).status, 404);
  assert.equal((await get("/halls/halle-3/series?from=2026-10-06", cookie)).status, 404);
  assert.equal((await get("/halls/halle-3/cost?date=2026-10-06", cookie)).status, 404);
  assert.equal((await get("/sites/nordwerk", cookie)).status, 404);
  assert.equal((await get("/sites/nordwerk/cost?date=2026-10-06", cookie)).status, 404);

  const viewer = await login("petra.koch@example.com", "viewer-2026");
  assert.deepEqual((await get("/sites", viewer)).body.map((s: any) => s.id), ["nordwerk"]);
});

test("maintenance windows: operators add them, everyone on the site lists them", async () => {
  const lena = await login("lena.hartmann@example.com", "operator-2026");
  const path = "/halls/halle-3/maintenance";
  assert.deepEqual((await get(path, lena)).body, []);

  // Local wall-clock times in Europe/Berlin; 2026-10-06 is CEST (+02:00).
  const r = await post(path, { asset: "boiler", start: "2026-10-06T08:00", end: "2026-10-06T12:30" }, lena);
  assert.equal(r.status, 201);
  const w = (await r.json()) as any;
  assert.equal(w.hall_id, "halle-3");
  assert.equal(w.asset, "boiler");
  assert.equal(w.start_utc, "2026-10-06T06:00:00.000Z");
  assert.equal(w.end_utc, "2026-10-06T10:30:00.000Z");
  assert.equal(w.start_local, "2026-10-06T08:00+02:00");
  assert.equal(w.created_by_name, "Lena Hartmann");

  // Across the DST change (2026-10-25 03:00 CEST -> 02:00 CET); an instant with offset is accepted too.
  assert.equal((await post(path, { asset: "fan", start: "2026-10-24T22:00", end: "2026-10-25T06:00+01:00" }, lena)).status, 201);
  const list = await get(path, lena);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((x: any) => x.asset), ["boiler", "fan"]);
  assert.equal(list.body[1].end_utc, "2026-10-25T05:00:00.000Z");
  assert.equal(list.body[1].end_local, "2026-10-25T06:00+01:00");

  const viewer = await login("petra.koch@example.com", "viewer-2026");
  assert.equal((await get(path, viewer)).body.length, 2);
  assert.equal((await post(path, { asset: "fan", start: "2026-10-06T08:00", end: "2026-10-06T09:00" }, viewer)).status, 403);
  assert.equal((await get("/halls/halle-7/maintenance", lena)).body.length, 0);
});

test("violations: measured breaches match the raw file and each belongs to one day", async () => {
  for (const hall of halls) {
    const raw = hall as unknown as { measured: { temperature_c: number[]; co2_ppm: number[] } };
    const expected = new Set<string>();
    raw.measured.temperature_c.forEach((T, i) => {
      if (T < hall.bounds.temp_min_c[i] - TOL) expected.add(`${i}:temp_below_min`);
      if (T > hall.bounds.temp_max_c[i] + TOL) expected.add(`${i}:temp_above_max`);
      if (raw.measured.co2_ppm[i] > hall.bounds.co2_max_ppm[i] + TOL) expected.add(`${i}:co2_above_max`);
    });
    assert.ok(expected.size > 0, `${hall.id} has measured breaches`);

    const { body: detail } = await get(`/halls/${hall.id}`);
    const seen: string[] = [];
    for (const d of detail.days) {
      const { status, body } = await get(`/halls/${hall.id}/violations?from=${d.date}&to=${d.date}`);
      assert.equal(status, 200);
      for (const v of body.violations) {
        assert.ok(v.over > 0);
        assert.ok(v.step >= body.step_start && v.step <= body.step_end);
        seen.push(`${v.step}:${v.constraint}`);
      }
    }
    // Days cover every state point once, including the 25-hour day.
    assert.equal(seen.length, new Set(seen).size);
    assert.deepEqual(new Set(seen), expected);
  }
});

test("violations: validation and access", async () => {
  const id = halls[0].id;
  assert.equal((await get(`/halls/${id}/violations`)).status, 400);
  assert.equal((await get(`/halls/${id}/violations?from=2020-01-01`)).status, 400);
  assert.equal((await get(`/halls/nope/violations?from=2026-10-06`)).status, 404);
  assert.equal((await get(`/halls/${id}/violations?from=2026-10-06`, "")).status, 401);
  const { body: sites } = await get("/sites");
  const suedwerkHall = sites.find((s: any) => s.id === "suedwerk").halls[0].id;
  const viewer = await login("petra.koch@example.com", "viewer-2026");
  assert.equal((await get(`/halls/${suedwerkHall}/violations?from=2026-10-06`, viewer)).status, 404);
});

test("maintenance windows: validation and access", async () => {
  const lena = await login("lena.hartmann@example.com", "operator-2026");
  const path = "/halls/halle-7/maintenance";
  const bad = async (body: unknown) => {
    const r = await post(path, body, lena);
    return { status: r.status, error: ((await r.json()) as any).error as string };
  };
  const end = await bad({ asset: "fan", start: "2026-10-06T08:00", end: "2026-10-06T08:00" });
  assert.equal(end.status, 400);
  assert.match(end.error, /after/);
  assert.equal((await bad({ asset: "fan", start: "2026-10-06T09:00", end: "2026-10-06T08:00" })).status, 400);
  assert.equal((await bad({ asset: "pump", start: "2026-10-06T08:00", end: "2026-10-06T09:00" })).status, 400);
  assert.equal((await bad({ asset: "fan", start: "2026-10-06", end: "2026-10-06T09:00" })).status, 400);
  assert.equal((await bad({ asset: "fan", start: "2026-02-30T08:00", end: "2026-10-06T09:00" })).status, 400);
  assert.equal((await bad({ asset: "fan", end: "2026-10-06T09:00" })).status, 400);
  // 02:30 does not exist in Berlin on 2027-03-28 (spring forward).
  assert.match((await bad({ asset: "fan", start: "2027-03-28T02:30", end: "2027-03-28T05:00" })).error, /does not exist/);
  assert.equal((await get(path, lena)).body.length, 0);

  // Other sites look missing; no login is 401.
  const tarek = await login("tarek.yilmaz@example.com", "operator-2026");
  assert.equal((await post(path, { asset: "fan", start: "2026-10-06T08:00", end: "2026-10-06T09:00" }, tarek)).status, 404);
  assert.equal((await get(path, tarek)).status, 404);
  assert.equal((await post(path, { asset: "fan", start: "2026-10-06T08:00", end: "2026-10-06T09:00" })).status, 401);
  assert.equal((await get(path, "")).status, 401);
  assert.equal((await fetch(base + path, { method: "DELETE", headers: { cookie: lena } })).status, 405);
});
