/* global atob, btoa */

export const SCRYPT_ALGORITHM = "scrypt-v1";
export const SCRYPT_N = 32_768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 3;
export const SCRYPT_MAXMEM = 64 * 1024 * 1024;
export const PBKDF2_ALGORITHM = "pbkdf2-sha256-v1";
export const PBKDF2_ITERATIONS = 600_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_DERIVED_KEY_BYTES = 32;

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

function hasExpectedLengths(salt, derived) {
  return salt.byteLength === PASSWORD_SALT_BYTES && derived.byteLength === PASSWORD_DERIVED_KEY_BYTES;
}

export function serializeScryptPasswordHash(salt, derived) {
  if (!hasExpectedLengths(salt, derived)) throw new Error("Unexpected scrypt output length");
  return `${SCRYPT_ALGORITHM}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export function serializePbkdf2PasswordHash(salt, derived) {
  if (!hasExpectedLengths(salt, derived)) throw new Error("Unexpected PBKDF2 output length");
  return `${PBKDF2_ALGORITHM}$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

function parseScryptPasswordHash(encoded) {
  const [algorithm, nRaw, rRaw, pRaw, saltRaw, derivedRaw, ...extra] = encoded.split("$");
  if (extra.length || algorithm !== SCRYPT_ALGORITHM || nRaw !== String(SCRYPT_N) || rRaw !== String(SCRYPT_R) || pRaw !== String(SCRYPT_P) || !saltRaw || !derivedRaw) return null;
  try {
    const salt = fromBase64Url(saltRaw);
    const derived = fromBase64Url(derivedRaw);
    if (!hasExpectedLengths(salt, derived)) return null;
    return { algorithm: SCRYPT_ALGORITHM, N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, salt, derived };
  } catch {
    return null;
  }
}

function parsePbkdf2PasswordHash(encoded) {
  const [algorithm, iterationsRaw, saltRaw, derivedRaw, ...extra] = encoded.split("$");
  if (extra.length || algorithm !== PBKDF2_ALGORITHM || !/^[1-9][0-9]*$/u.test(iterationsRaw ?? "")) return null;
  const iterations = Number(iterationsRaw);
  if (!Number.isSafeInteger(iterations) || iterations < PBKDF2_ITERATIONS || iterations > 2_000_000 || !saltRaw || !derivedRaw) return null;
  try {
    const salt = fromBase64Url(saltRaw);
    const derived = fromBase64Url(derivedRaw);
    if (!hasExpectedLengths(salt, derived)) return null;
    return { algorithm: PBKDF2_ALGORITHM, iterations, salt, derived };
  } catch {
    return null;
  }
}

export function parsePasswordHash(encoded) {
  if (encoded.startsWith(`${SCRYPT_ALGORITHM}$`)) return parseScryptPasswordHash(encoded);
  if (encoded.startsWith(`${PBKDF2_ALGORITHM}$`)) return parsePbkdf2PasswordHash(encoded);
  return null;
}
