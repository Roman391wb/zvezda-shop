import { constantTimeEqualBytes, randomToken } from "./crypto";
import { fromBase64Url, PASSWORD_ALGORITHM, PASSWORD_DERIVED_KEY_BITS, PASSWORD_ITERATIONS, parsePasswordHash, serializePasswordHash } from "./password-format.js";

const encoder = new TextEncoder();

function derivationFailure(stage: "import" | "derive" | "export"): Error {
  const error = new Error("PBKDF2 derivation failed");
  error.name = `pbkdf2_${stage}_failed`;
  return error;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  let key: CryptoKey;
  try { key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]); } catch { throw derivationFailure("import"); }
  const saltCopy = new Uint8Array(salt.byteLength);
  saltCopy.set(salt);
  let derived: CryptoKey;
  try { derived = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: { name: "SHA-256" }, salt: saltCopy, iterations }, key, { name: "HMAC", hash: { name: "SHA-256" }, length: PASSWORD_DERIVED_KEY_BITS }, true, ["sign"]); } catch { throw derivationFailure("derive"); }
  try { return new Uint8Array(await crypto.subtle.exportKey("raw", derived)); } catch { throw derivationFailure("export"); }
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
