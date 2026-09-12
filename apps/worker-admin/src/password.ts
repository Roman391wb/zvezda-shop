import { constantTimeEqualBytes, randomToken } from "./crypto";
import { scrypt } from "node:crypto";
import { fromBase64Url, PASSWORD_DERIVED_KEY_BYTES, SCRYPT_ALGORITHM, SCRYPT_MAXMEM, SCRYPT_N, SCRYPT_P, SCRYPT_R, parsePasswordHash, serializeScryptPasswordHash } from "./password-format.js";

const encoder = new TextEncoder();

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltCopy = new Uint8Array(salt.byteLength);
  saltCopy.set(salt);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltCopy, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function deriveScrypt(password: string, salt: Uint8Array, N: number, r: number, p: number): Promise<Uint8Array> {
  return await new Promise<Uint8Array>((resolve, reject) => {
    scrypt(encoder.encode(password), salt, PASSWORD_DERIVED_KEY_BYTES, { N, r, p, maxmem: SCRYPT_MAXMEM }, (error, derived) => {
      if (error) reject(error);
      else resolve(new Uint8Array(derived));
    });
  });
}

export interface PasswordHasher {
  algorithm: string;
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

export type PasswordVerificationStatus = "valid" | "malformed" | "mismatch" | "derive_failed";
export type ScryptDeriver = (password: string, salt: Uint8Array, N: number, r: number, p: number) => Promise<Uint8Array>;

export async function verifyPassword(password: string, encoded: string, scryptDeriver: ScryptDeriver = deriveScrypt): Promise<{ valid: boolean; status: PasswordVerificationStatus; errorName?: string }> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return { valid: false, status: "malformed" };
  try {
    const actual = "N" in parsed
      ? await scryptDeriver(password, parsed.salt, parsed.N, parsed.r, parsed.p)
      : await derivePbkdf2(password, parsed.salt, parsed.iterations);
    const valid = constantTimeEqualBytes(actual, parsed.derived);
    return { valid, status: valid ? "valid" : "mismatch" };
  } catch (error) {
    return { valid: false, status: "derive_failed", errorName: error instanceof Error ? error.name : "unknown" };
  }
}

export const passwordHasher: PasswordHasher = {
  algorithm: SCRYPT_ALGORITHM,
  async hash(password) {
    const salt = fromBase64Url(randomToken(16));
    return serializeScryptPasswordHash(salt, await deriveScrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P));
  },
  async verify(password, encoded) {
    return (await verifyPassword(password, encoded)).valid;
  }
};
