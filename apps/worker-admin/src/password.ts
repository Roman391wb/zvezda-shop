import { constantTimeEqualBytes, randomToken } from "./crypto";
import { fromBase64Url, PASSWORD_ALGORITHM, PASSWORD_ITERATIONS, parsePasswordHash, serializePasswordHash } from "./password-format.js";

const encoder = new TextEncoder();

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltCopy = new Uint8Array(salt.byteLength);
  saltCopy.set(salt);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltCopy, iterations }, key, 256);
  return new Uint8Array(bits);
}

export interface PasswordHasher {
  algorithm: string;
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

export const passwordHasher: PasswordHasher = {
  algorithm: PASSWORD_ALGORITHM,
  async hash(password) {
    const salt = fromBase64Url(randomToken(16));
    return serializePasswordHash(salt, await derive(password, salt, PASSWORD_ITERATIONS));
  },
  async verify(password, encoded) {
    const parsed = parsePasswordHash(encoded);
    if (!parsed) return false;
    try { return constantTimeEqualBytes(await derive(password, parsed.salt, parsed.iterations), parsed.derived); } catch { return false; }
  }
};
