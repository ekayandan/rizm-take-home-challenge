import { createServer } from "node:http";
import { DB_PATH, openDb, type DB } from "./db.ts";
import { createHandler } from "./app.ts";
import { enablePerfLog, perfLog } from "./perf.ts";

const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? "127.0.0.1";

let db: DB | undefined;
const getDb = (): DB => (db ??= openDb(DB_PATH));

try {
  getDb();
} catch (err) {
  console.warn(`[api] ${(err as Error).message}; requests will answer 503 until the database can be used`);
}

enablePerfLog();
const handler = createHandler(getDb);
const server = createServer((req, res) => {
  const start = performance.now();
  res.on("finish", () => perfLog(`${req.method} ${req.url} ${res.statusCode}`, performance.now() - start));
  handler(req, res);
});
server.listen(PORT, HOST, () => console.log(`[api] listening on http://${HOST}:${PORT}/api`));

const shutdown = () => server.close(() => { db?.close(); process.exit(0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
