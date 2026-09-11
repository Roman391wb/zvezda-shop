import { constantTimeEqual, randomToken, toBase64Url } from "./crypto";

const ITERATIONS = 600_000;
const ALGORITHM = "pbkdf2-sha256-v1";
const encoder = new TextEncoder();

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltCopy = new Uint8Array(salt.byteLength);
  saltCopy.set(salt);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltCopy, iterations }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}

export interface PasswordHasher {
  algorithm: string;
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

export const passwordHasher: PasswordHasher = {
  algorithm: ALGORITHM,
  async hash(password) {
    const salt = fromBase64Url(randomToken(16));
    const derived = await derive(password, salt, ITERATIONS);
    return `${ALGORITHM}$${ITERATIONS}$${toBase64Url(salt)}$${derived}`;
  },
  async verify(password, encoded) {
    const [algorithm, iterationsRaw, saltRaw, expected, ...extra] = encoded.split("$");
    const iterations = Number(iterationsRaw);
    if (extra.length || algorithm !== ALGORITHM || !Number.isInteger(iterations) || iterations < 600_000 || iterations > 2_000_000 || !saltRaw || !expected) return false;
    try { return constantTimeEqual(await derive(password, fromBase64Url(saltRaw), iterations), expected); } catch { return false; }
  }
};
