import { createServer } from "node:http";
import { DB_PATH, openDb, type DB } from "./db.ts";
import { createHandler } from "./app.ts";

const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? "127.0.0.1";

let db: DB | undefined;
const getDb = (): DB => (db ??= openDb(DB_PATH));

try {
  getDb();
} catch (err) {
  console.warn(`[api] ${(err as Error).message}; requests will fail with 503 until it exists`);
}

const server = createServer(createHandler(getDb));
server.listen(PORT, HOST, () => console.log(`[api] listening on http://${HOST}:${PORT}/api`));

const shutdown = () => server.close(() => { db?.close(); process.exit(0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
