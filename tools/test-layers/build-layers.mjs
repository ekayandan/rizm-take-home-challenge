// Builds one database per data layer from a seeded full.db, for the manual tests in docs/issue-7-errors-and-empty-states.md.
// Usage: node --experimental-sqlite build-layers.mjs <dir with full.db> <schema.sql>
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, readFileSync, rmSync, existsSync } from "node:fs";

const [dir, schema] = process.argv.slice(2);
const a = "'halle-a'", day = "'2026-10-06'";

const make = (name, sql) => {
  const p = `${dir}/${name}.db`;
  if (existsSync(p)) rmSync(p);
  copyFileSync(`${dir}/full.db`, p);
  const db = new DatabaseSync(p);
  db.exec(`PRAGMA foreign_keys = ON;${sql}`);
  db.exec("VACUUM");
  db.close();
};

make("l2-users-only", "DELETE FROM sites;");
make("l3-sites-no-halls", "DELETE FROM halls;");
make("l4-hall-no-steps", "DELETE FROM schedules; DELETE FROM hall_steps;");
make("l5-steps-no-schedules", "DELETE FROM schedules;");
make("l6-one-hall-no-schedule", `DELETE FROM schedules WHERE hall_id=${a};`);
make("l7-price-null-day", `UPDATE hall_steps SET price_eur_per_mwh=NULL WHERE hall_id=${a} AND local_date=${day};`);
make("l8-day-removed", `DELETE FROM schedule_steps WHERE hall_id=${a} AND step IN (SELECT step FROM hall_steps WHERE hall_id=${a} AND local_date=${day}); DELETE FROM hall_steps WHERE hall_id=${a} AND local_date=${day};`);
make("l9-measured-null-day", `UPDATE hall_steps SET measured_temperature_c=NULL, measured_co2_ppm=NULL WHERE hall_id=${a} AND local_date=${day};`);

const empty = `${dir}/l1-schema-only.db`;
if (existsSync(empty)) rmSync(empty);
const db = new DatabaseSync(empty);
db.exec(readFileSync(schema, "utf8"));
db.close();
