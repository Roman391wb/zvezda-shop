/* global atob, btoa */

export const PASSWORD_ALGORITHM = "pbkdf2-sha256-v1";
export const PASSWORD_ITERATIONS = 600_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_DERIVED_KEY_BYTES = 32;
export const PASSWORD_DERIVED_KEY_BITS = PASSWORD_DERIVED_KEY_BYTES * 8;

const BASE64_URL = /^[A-Za-z0-9_-]+$/u;

export function toBase64Url(input) {
  let binary = "";
  for (const value of input) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value) {
  if (!BASE64_URL.test(value) || value.length % 4 === 1) throw new Error("Invalid base64url value");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const decoded = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (toBase64Url(decoded) !== value) throw new Error("Non-canonical base64url value");
  return decoded;
}

export function serializePasswordHash(salt, derived) {
  if (salt.byteLength !== PASSWORD_SALT_BYTES || derived.byteLength !== PASSWORD_DERIVED_KEY_BYTES) throw new Error("Unexpected PBKDF2 output length");
  return `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export function parsePasswordHash(encoded) {
  const [algorithm, iterationsRaw, saltRaw, derivedRaw, ...extra] = encoded.split("$");
  if (extra.length || algorithm !== PASSWORD_ALGORITHM || !/^[1-9][0-9]*$/u.test(iterationsRaw ?? "")) return null;
  const iterations = Number(iterationsRaw);
  if (!Number.isSafeInteger(iterations) || iterations < PASSWORD_ITERATIONS || iterations > 2_000_000 || !saltRaw || !derivedRaw) return null;
  try {
    const salt = fromBase64Url(saltRaw);
    const derived = fromBase64Url(derivedRaw);
    if (salt.byteLength !== PASSWORD_SALT_BYTES || derived.byteLength !== PASSWORD_DERIVED_KEY_BYTES) return null;
    return { iterations, salt, derived };
  } catch {
    return null;
  }
}
