#!/usr/bin/env node
/*
 * One-time bootstrap helper. It reads the password from the current TTY,
 * generates a PBKDF2 hash locally and prints a single INSERT statement. The
 * plaintext password never enters Git or the printed SQL.
 */
import { stdin as input, stdout as output } from "node:process";
import { randomBytes, pbkdf2Sync, randomUUID } from "node:crypto";
import { PASSWORD_ALGORITHM, PASSWORD_ITERATIONS, serializePasswordHash } from "../src/password-format.js";
import { readInteractivePassword } from "./bootstrap-password-input.mjs";

const login = process.env.ADMIN_LOGIN?.trim();
if (!login || login.length < 3 || login.length > 120) throw new Error("Set ADMIN_LOGIN (3–120 characters) before running this command.");
if (!input.isTTY) throw new Error("Run this bootstrap helper from an interactive TTY.");
output.write("Initial ADMIN password: ");
const password = await readInteractivePassword(input, output);
if (password.length < 8 || password.length > 256) throw new Error("Password must contain 8–256 characters.");

const now = Date.now();
const normalized = login.toLocaleLowerCase("en-US");
const salt = randomBytes(16);
const digest = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
const hash = serializePasswordHash(salt, digest);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

console.log(`INSERT INTO admin_users (id, login_normalized, display_login, password_hash, password_algorithm, role, is_active, session_version, password_changed_at, created_at, updated_at) VALUES (${quote(randomUUID())}, ${quote(normalized)}, ${quote(login)}, ${quote(hash)}, ${quote(PASSWORD_ALGORITHM)}, 'ADMIN', 1, 1, ${now}, ${now}, ${now});`);
console.error("Run the printed statement once with wrangler d1 execute. Do not save it in the repository.");
