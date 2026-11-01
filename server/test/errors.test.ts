/**
 * Issue 7: how the API answers duplicate saves and an unusable database. IDs refer to the
 * findings in task-7.md. Seeds its own temporary database, because these tests add and remove data.
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
const tmp = mkdtempSync(join(tmpdir(), "hall-errors-"));
const dbPath = join(tmp, "test.db");
process.env.DB_PATH = dbPath;

const servers: Server[] = [];
let base = "";
let cookie = "";

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api`;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const windows = async (hall: string) => (await (await fetch(`${base}/halls/${hall}/maintenance`, { headers: { cookie } })).json()) as unknown[];
const addWindow = (hall: string, asset: string, start: string, end: string) =>
  post(`${base}/halls/${hall}/maintenance`, { asset, start, end });

before(async () => {
  execFileSync(process.execPath, ["--experimental-strip-types", "--experimental-sqlite", "--no-warnings", join(root, "server/src/seed.ts")], {
    env: { ...process.env, DB_PATH: dbPath },
    stdio: "pipe",
  });
  const { openDb } = await import("../src/db.ts");
  const { createHandler } = await import("../src/app.ts");
  const db = openDb(dbPath);
  // C2: halle-3 loses every row of one day, leaving a gap in the middle of its horizon.
  db.prepare("DELETE FROM schedule_steps WHERE hall_id = 'halle-3' AND step IN (SELECT step FROM hall_steps WHERE hall_id = 'halle-3' AND local_date = '2026-10-06')").run();
  db.prepare("DELETE FROM hall_steps WHERE hall_id = 'halle-3' AND local_date = '2026-10-06'").run();
  base = await listen(createHandler(() => db));
  const r = await post(`${base}/auth/login`, { email: "jonas.weber@example.com", password: "admin-2026" });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
});

after(() => {
  for (const s of servers) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("C1/P15: saving an identical window again answers 409 and adds no row", async () => {
  const first = await addWindow("halle-a", "fan", "2026-10-12T06:00", "2026-10-12T14:00");
  assert.equal(first.status, 201);
  const count = (await windows("halle-a")).length;

  const second = await addWindow("halle-a", "fan", "2026-10-12T06:00", "2026-10-12T14:00");
  assert.equal(second.status, 409);
  assert.match(((await second.json()) as any).error, /Jonas Weber/, "says who already recorded it");
  assert.equal((await windows("halle-a")).length, count);
});

test("C1: the same instant written with an offset counts as identical", async () => {
  await addWindow("halle-a", "boiler", "2026-10-13T06:00", "2026-10-13T14:00");
  const again = await addWindow("halle-a", "boiler", "2026-10-13T06:00+02:00", "2026-10-13T14:00+02:00");
  assert.equal(again.status, 409);
});

test("C1: windows differing in asset, time or hall are still accepted", async () => {
  assert.equal((await addWindow("halle-a", "fan", "2026-10-14T06:00", "2026-10-14T14:00")).status, 201);
  assert.equal((await addWindow("halle-a", "chiller", "2026-10-14T06:00", "2026-10-14T14:00")).status, 201);
  assert.equal((await addWindow("halle-a", "fan", "2026-10-14T06:00", "2026-10-14T15:00")).status, 201);
  assert.equal((await addWindow("halle-7", "fan", "2026-10-14T06:00", "2026-10-14T14:00")).status, 201);
});

test("P1: a missing database answers 503 without a file path or command", async () => {
  const { createHandler } = await import("../src/app.ts");
  const { MissingDatabase } = await import("../src/db.ts");
  const url = await listen(createHandler(() => {
    throw new MissingDatabase("database /secret/path/app.db does not exist, run `npm run seed` first");
  }));
  const r = await post(`${url}/auth/login`, { email: "a@b.c", password: "x" });
  assert.equal(r.status, 503);
  const { error } = (await r.json()) as { error: string };
  assert.doesNotMatch(error, /\/secret|app\.db|npm run/);
});

test("C3: health reports an unusable database", async () => {
  const { createHandler } = await import("../src/app.ts");
  const url = await listen(createHandler(() => {
    throw new Error("database disk image is malformed");
  }));
  const r = await fetch(`${url}/health`);
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as any).ok, false);
});

test("C3: health stays OK with a working database", async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as any).ok, true);
});

test("C3: a corrupt database answers 503, not a bare internal error", async () => {
  const { createHandler } = await import("../src/app.ts");
  const url = await listen(createHandler(() => {
    throw Object.assign(new Error("database disk image is malformed"), { code: "ERR_SQLITE_ERROR" });
  }));
  const r = await post(`${url}/auth/login`, { email: "a@b.c", password: "x" });
  assert.equal(r.status, 503);
  assert.doesNotMatch(((await r.json()) as any).error, /malformed/);
});

// Open decision in task-7.md: refuse the cost, or return it flagged. Either satisfies this test.
test("C2: a cost simulated across missing data is refused or flagged", { todo: "decide refuse or flag" }, async () => {
  const r = await fetch(`${base}/halls/halle-3/cost?date=2026-10-07&schedule=optimized`, { headers: { cookie } });
  if (r.status === 200) {
    const body = (await r.json()) as any;
    assert.equal(body.schedules.optimized.data_gap, true);
  } else {
    assert.equal(r.status, 400);
  }
});
