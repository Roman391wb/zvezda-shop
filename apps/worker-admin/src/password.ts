import { constantTimeEqualBytes, randomToken } from "./crypto";
import { pbkdf2 } from "node:crypto";
import { fromBase64Url, PASSWORD_ALGORITHM, PASSWORD_DERIVED_KEY_BYTES, PASSWORD_ITERATIONS, parsePasswordHash, serializePasswordHash } from "./password-format.js";

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return await new Promise<Uint8Array>((resolve, reject) => {
    pbkdf2(password, salt, iterations, PASSWORD_DERIVED_KEY_BYTES, "sha256", (error, derived) => {
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
