/**
 * Seeds the SQLite database from data/: sites.json, users.json and halls/*.json.
 * Drops and recreates the database file every run, so it is safe to re-run.
 *
 *   npm run seed
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { simulate, validateInstance, validateSchedule, type Instance, type Schedule } from "../checker/checker.ts";
import { hashPassword } from "./auth.ts";
import { DATA_DIR, DB_PATH, SCHEMA_PATH, openDb, transaction } from "./db.ts";
import { localParts } from "./time.ts";
import { listScheduleNames, loadInstance, loadSchedule } from "./repo.ts";

interface SitesFile {
  sites: { id: string; name: string; city: string; timezone: string }[];
  halls: { id: string; site_id: string; name: string }[];
}
interface UsersFile {
  users: { id: string; name: string; email: string; password: string; role: string; sites: string[] }[];
}
interface HallFile extends Instance {
  id: string;
  site_id: string;
  name: string;
  notes?: string;
  timezone: string;
  start_utc: string;
  dt_minutes: number;
  shifts?: unknown;
  comfort?: unknown;
  measured?: { temperature_c?: number[]; co2_ppm?: number[] };
  schedules: Record<string, Schedule>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;


function seed(): void {
  const sitesFile = readJson<SitesFile>(join(DATA_DIR, "sites.json"));
  const usersFile = readJson<UsersFile>(join(DATA_DIR, "users.json"));
  const hallDir = join(DATA_DIR, "halls");
  const hallFiles = readdirSync(hallDir).filter((f) => f.endsWith(".json")).sort();

  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(DB_PATH + suffix)) rmSync(DB_PATH + suffix);
  const db = openDb(DB_PATH, { create: true });
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const insSite = db.prepare("INSERT INTO sites (id, name, city, timezone) VALUES (@id, @name, @city, @timezone)");
  const insUser = db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role) VALUES (@id, @name, @email, @password_hash, @role)",
  );
  const insUserSite = db.prepare("INSERT INTO user_sites (user_id, site_id) VALUES (?, ?)");
  const insHall = db.prepare(`
    INSERT INTO halls (id, site_id, name, notes, timezone, start_utc, dt_minutes, steps, dt_hours,
      constants_json, room_json, hvac_json, initial_state_json, comfort_json, shifts_json)
    VALUES (@id, @site_id, @name, @notes, @timezone, @start_utc, @dt_minutes, @steps, @dt_hours,
      @constants_json, @room_json, @hvac_json, @initial_state_json, @comfort_json, @shifts_json)`);
  const insStep = db.prepare(`
    INSERT INTO hall_steps (hall_id, step, ts_utc, local_date, local_time, utc_offset_min,
      price_eur_per_mwh, outdoor_temp_c, internal_heat_kw, co2_generation_m3_per_h, occupancy_persons,
      temp_min_c, temp_max_c, co2_max_ppm, measured_temperature_c, measured_co2_ppm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insSchedule = db.prepare("INSERT INTO schedules (hall_id, name) VALUES (?, ?)");
  const insSchedStep = db.prepare(`
    INSERT INTO schedule_steps (hall_id, schedule_name, step, mass_flow_kg_per_s, recirculation, heating_kw, cooling_kw)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  const siteIds = new Set(sitesFile.sites.map((s) => s.id));
  const listedHalls = new Map(sitesFile.halls.map((h) => [h.id, h]));

  transaction(db, () => {
    for (const s of sitesFile.sites) insSite.run(s);

    for (const u of usersFile.users) {
      insUser.run({ id: u.id, name: u.name, email: u.email, role: u.role, password_hash: hashPassword(u.password) });
      for (const siteId of u.sites) {
        if (!siteIds.has(siteId)) throw new Error(`user ${u.id} refers to unknown site ${siteId}`);
        insUserSite.run(u.id, siteId);
      }
    }

    for (const file of hallFiles) {
      const h = readJson<HallFile>(join(hallDir, file));
      const listed = listedHalls.get(h.id);
      if (!listed) throw new Error(`${file}: hall ${h.id} is not listed in sites.json`);
      if (listed.site_id !== h.site_id) throw new Error(`${file}: site ${h.site_id} differs from sites.json (${listed.site_id})`);
      validateInstance(h);
      const n = h.horizon.steps;
      if (Math.abs(h.dt_minutes / 60 - h.horizon.dt_hours) > 1e-9) throw new Error(`${file}: dt_minutes and dt_hours disagree`);

      insHall.run({
        id: h.id,
        site_id: h.site_id,
        name: listed.name ?? h.name,
        notes: h.notes ?? null,
        timezone: h.timezone,
        start_utc: h.start_utc,
        dt_minutes: h.dt_minutes,
        steps: n,
        dt_hours: h.horizon.dt_hours,
        constants_json: JSON.stringify(h.constants),
        room_json: JSON.stringify(h.room),
        hvac_json: JSON.stringify(h.hvac),
        initial_state_json: JSON.stringify(h.initial_state),
        comfort_json: h.comfort === undefined ? null : JSON.stringify(h.comfort),
        shifts_json: h.shifts === undefined ? null : JSON.stringify(h.shifts),
      });

      const start = Date.parse(h.start_utc);
      if (Number.isNaN(start)) throw new Error(`${file}: invalid start_utc`);
      const s = h.series, b = h.bounds, m = h.measured ?? {};
      for (let k = 0; k <= n; k++) {
        const t = start + k * h.dt_minutes * 60_000;
        const local = localParts(t, h.timezone);
        const inStep = k < n;
        insStep.run(
          h.id, k, new Date(t).toISOString(), local.date, local.time, local.offsetMin,
          inStep ? s.price_eur_per_mwh[k] : null,
          inStep ? s.outdoor_temp_c[k] : null,
          inStep ? s.internal_heat_kw[k] : null,
          inStep ? s.co2_generation_m3_per_h[k] : null,
          inStep ? (s.occupancy_persons?.[k] ?? null) : null,
          b.temp_min_c[k], b.temp_max_c[k], b.co2_max_ppm[k],
          m.temperature_c?.[k] ?? null, m.co2_ppm?.[k] ?? null,
        );
      }

      for (const [name, sched] of Object.entries(h.schedules ?? {})) {
        validateSchedule(sched, h);
        insSchedule.run(h.id, name);
        for (let k = 0; k < n; k++) {
          insSchedStep.run(h.id, name, k, sched.mass_flow_kg_per_s[k], sched.recirculation[k], sched.heating_kw[k], sched.cooling_kw[k]);
        }
      }
    }
  });

  // Round-trip check: rebuild each instance from the database and simulate the full horizon.
  console.log(`Seeded ${DB_PATH}`);
  console.log(`  ${sitesFile.sites.length} sites, ${hallFiles.length} halls, ${usersFile.users.length} users`);
  for (const file of hallFiles) {
    const id = readJson<HallFile>(join(hallDir, file)).id;
    const inst = loadInstance(db, id)!;
    const names = listScheduleNames(db, id);
    const parts = names.map((name) => {
      const r = simulate(inst, loadSchedule(db, id, name)!);
      return `${name} ${r.cost_eur.toFixed(2)} EUR (${r.feasible ? "feasible" : `${r.n_violations} violations`})`;
    });
    console.log(`  ${id}: ${inst.horizon.steps} steps; ${parts.join(", ")}`);
  }
  db.close();
}

seed();
