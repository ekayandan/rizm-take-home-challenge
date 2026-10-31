/** Password hashing, sessions and the session cookie. */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DB } from "./db.ts";

export type Role = "admin" | "operator" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Site ids the user may see. Admins see every site. */
  sites: string[];
}

export const SESSION_COOKIE = "hvac_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const KEY_LEN = 32;

/** scrypt$<salt hex>$<hash hex> */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

// Compared against when the email is unknown, so a miss costs as much time as a wrong password.
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function loadUser(db: DB, id: string): User | undefined {
  const row = db.prepare("SELECT id, name, email, role FROM users WHERE id = ?").get(id) as
    | { id: string; name: string; email: string; role: Role }
    | undefined;
  if (!row) return undefined;
  const sites =
    row.role === "admin"
      ? (db.prepare("SELECT id FROM sites ORDER BY id").all() as { id: string }[])
      : (db.prepare("SELECT site_id AS id FROM user_sites WHERE user_id = ? ORDER BY site_id").all(row.id) as { id: string }[]);
  return { ...row, sites: sites.map((s) => s.id) };
}

/** The user for an email and password, or undefined if they do not match. */
export function authenticate(db: DB, email: string, password: string): User | undefined {
  const row = db.prepare("SELECT id, password_hash FROM users WHERE email = ? COLLATE NOCASE").get(email.trim()) as
    | { id: string; password_hash: string }
    | undefined;
  const ok = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  return ok && row ? loadUser(db, row.id) : undefined;
}

/** Creates a session and returns its token (the cookie value). */
export function createSession(db: DB, userId: string, now = Date.now()): string {
  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date(now).toISOString());
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    sha256(token), userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString(),
  );
  return token;
}

export function sessionUser(db: DB, token: string | undefined, now = Date.now()): User | undefined {
  if (!token) return undefined;
  const row = db.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?").get(
    sha256(token), new Date(now).toISOString(),
  ) as { user_id: string } | undefined;
  return row ? loadUser(db, row.user_id) : undefined;
}

export function deleteSession(db: DB, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
