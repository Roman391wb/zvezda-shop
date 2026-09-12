import { constantTimeEqualBytes, randomToken } from "./crypto";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase64Url, PASSWORD_ALGORITHM, PASSWORD_DERIVED_KEY_BYTES, PASSWORD_ITERATIONS, parsePasswordHash, serializePasswordHash } from "./password-format.js";

const encoder = new TextEncoder();

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return await pbkdf2Async(sha256, encoder.encode(password), salt, { c: iterations, dkLen: PASSWORD_DERIVED_KEY_BYTES, asyncTick: 10 });
}

export interface PasswordHasher {
  algorithm: string;
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

export type PasswordVerificationStatus = "valid" | "malformed" | "mismatch" | "derive_failed";

export async function verifyPassword(password: string, encoded: string): Promise<{ valid: boolean; status: PasswordVerificationStatus; errorName?: string }> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return { valid: false, status: "malformed" };
  try {
    const valid = constantTimeEqualBytes(await derive(password, parsed.salt, parsed.iterations), parsed.derived);
    return { valid, status: valid ? "valid" : "mismatch" };
  } catch (error) {
    return { valid: false, status: "derive_failed", errorName: error instanceof Error ? error.name : "unknown" };
  }
}

export const passwordHasher: PasswordHasher = {
  algorithm: PASSWORD_ALGORITHM,
  async hash(password) {
    const salt = fromBase64Url(randomToken(16));
    return serializePasswordHash(salt, await derive(password, salt, PASSWORD_ITERATIONS));
  },
  async verify(password, encoded) {
    return (await verifyPassword(password, encoded)).valid;
  }
};
