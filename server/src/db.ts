// node:sqlite is built into Node 22 (behind --experimental-sqlite before 22.13), so the
// database needs no native add-on. The npm scripts pass the flag; it is a no-op on newer Node.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const PRODUCT_ROOT = join(here, "..", "..");
export const DATA_DIR = join(PRODUCT_ROOT, "data");
export const SCHEMA_PATH = join(here, "schema.sql");
export const DB_PATH = process.env.DB_PATH ?? join(DATA_DIR, "app.db");

export type DB = DatabaseSync;

export class MissingDatabase extends Error {}

export function openDb(path: string = DB_PATH, opts: { create?: boolean } = {}): DB {
  if (!opts.create && path !== ":memory:" && !existsSync(path)) {
    throw new MissingDatabase(`database ${path} does not exist, run \`npm run seed\` first`);
  }
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

/** Runs fn inside a transaction. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
