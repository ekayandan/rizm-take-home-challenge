/**
 * Days and step counts when price data is missing. Seeds its own temporary database, because
 * these tests remove data that api.test.ts relies on.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "hall-days-"));
const dbPath = join(tmp, "test.db");
process.env.DB_PATH = dbPath;

let server: Server;
let base = "";
let cookie = "";

const get = async (path: string) => {
  const r = await fetch(base + path, { headers: { cookie } });
  return { status: r.status, body: (await r.json()) as any };
};
const siteHall = async (id: string) => (await get("/sites")).body.flatMap((s: any) => s.halls).find((h: any) => h.id === id);
const hallDay = async (id: string, date: string) => (await get(`/halls/${id}`)).body.days.find((d: any) => d.date === date);

before(async () => {
  execFileSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", join(root, "server/src/seed.ts")], {
    env: { ...process.env, DB_PATH: dbPath },
    stdio: "pipe",
  });
  const { openDb } = await import("../src/db.ts");
  const { createHandler } = await import("../src/app.ts");
  const db = openDb(dbPath);

  // halle-3: one day without prices, one with half of them. halle-a: no prices at all.
  const clear = db.prepare("UPDATE hall_steps SET price_eur_per_mwh = NULL WHERE hall_id = ? AND local_date = ?");
  clear.run("halle-3", "2026-10-14");
  db.prepare("UPDATE hall_steps SET price_eur_per_mwh = NULL WHERE hall_id = ? AND local_date = ? AND local_time >= '12:00'").run("halle-3", "2026-10-15");
  db.prepare("UPDATE hall_steps SET price_eur_per_mwh = NULL WHERE hall_id = ?").run("halle-a");

  server = createServer(createHandler(() => db));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api`;
  const r = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "jonas.weber@example.com", password: "admin-2026" }),
  });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
});

after(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("a day without prices is left out of the day list", async () => {
  assert.equal(await hallDay("halle-3", "2026-10-14"), undefined);
  assert.equal((await siteHall("halle-3")).days.some((d: any) => d.date === "2026-10-14"), false);
  assert.equal((await hallDay("halle-3", "2026-10-13")).steps, 96);
});

test("a partly priced day counts only its priced steps", async () => {
  assert.equal((await hallDay("halle-3", "2026-10-15")).steps, 48);
  assert.deepEqual(
    (await siteHall("halle-3")).days.find((d: any) => d.date === "2026-10-15"),
    { date: "2026-10-15", steps: 48 },
  );
});

test("the clock-change and ordinary counts are untouched by another hall's gaps", async () => {
  const days = (await siteHall("halle-7")).days;
  assert.equal(days.length, 30);
  assert.equal(days.find((d: any) => d.date === "2026-10-25").steps, 100);
  assert.equal(days.find((d: any) => d.date === "2026-10-14").steps, 96);
});

test("the sites list and hall detail agree on every day", async () => {
  const detail = (await get("/halls/halle-3")).body.days.map(({ date, steps }: any) => ({ date, steps }));
  assert.deepEqual((await siteHall("halle-3")).days, detail);
});

test("a hall with no prices has an empty day list", async () => {
  assert.deepEqual((await siteHall("halle-a")).days, []);
  const { status, body } = await get("/halls/halle-a");
  assert.equal(status, 200);
  assert.deepEqual(body.days, []);
  assert.equal(body.first_date, null);
  assert.equal(body.last_date, null);
});

test("a site reports the hall missing a day instead of failing", async () => {
  const { status, body } = await get("/sites/nordwerk/cost?date=2026-10-14");
  assert.equal(status, 200);
  assert.equal(body.complete, false);
  const hall = body.halls.find((h: any) => h.hall_id === "halle-3");
  assert.equal(hall.cost_eur, null);
  assert.equal(hall.reason, "no data for this day");
  assert.ok(body.total_cost_eur !== null, "the other hall still counts");
});

test("a site with no priced hall has no total", async () => {
  const { status, body } = await get("/sites/suedwerk/cost?date=2026-10-14");
  assert.equal(status, 200);
  assert.equal(body.total_cost_eur, null);
  assert.equal(body.complete, false);
});
