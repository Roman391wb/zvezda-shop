#!/usr/bin/env node
/*
 * One-time bootstrap helper. It reads the password from the current TTY,
 * generates a PBKDF2 hash locally and prints a single INSERT statement. The
 * plaintext password never enters Git or the printed SQL.
 */
import { stdin as input, stdout as output } from "node:process";
import { randomBytes, pbkdf2Sync, randomUUID } from "node:crypto";

const login = process.env.ADMIN_LOGIN?.trim();
if (!login || login.length < 3 || login.length > 120) throw new Error("Set ADMIN_LOGIN (3–120 characters) before running this command.");
if (!input.isTTY) throw new Error("Run this bootstrap helper from an interactive TTY.");
const password = await new Promise((resolve, reject) => {
  let value = "";
  output.write("Initial ADMIN password: ");
  input.setRawMode(true); input.resume();
  const onData = (chunk) => {
    const text = chunk.toString("utf8");
    if (text === "\u0003") { cleanup(); reject(new Error("Cancelled")); return; }
    if (text === "\r" || text === "\n") { cleanup(); output.write("\n"); resolve(value); return; }
    if (text === "\u007f") { value = value.slice(0, -1); return; }
    value += text;
  };
  const cleanup = () => { input.off("data", onData); input.setRawMode(false); input.pause(); };
  input.on("data", onData);
});
if (password.length < 8 || password.length > 256) throw new Error("Password must contain 8–256 characters.");

const now = Date.now();
const normalized = login.toLocaleLowerCase("en-US");
const salt = randomBytes(16).toString("base64url");
const digest = pbkdf2Sync(password, Buffer.from(salt, "base64url"), 600_000, 32, "sha256").toString("base64url");
const hash = `pbkdf2-sha256-v1$600000$${salt}$${digest}`;
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

console.log(`INSERT INTO admin_users (id, login_normalized, display_login, password_hash, password_algorithm, role, is_active, session_version, password_changed_at, created_at, updated_at) VALUES (${quote(randomUUID())}, ${quote(normalized)}, ${quote(login)}, ${quote(hash)}, 'pbkdf2-sha256-v1', 'ADMIN', 1, 1, ${now}, ${now}, ${now});`);
console.error("Run the printed statement once with wrangler d1 execute. Do not save it in the repository.");
