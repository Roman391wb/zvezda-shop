import { describe, expect, it } from "vitest";
import { pbkdf2Sync, scryptSync } from "node:crypto";
import { PASSWORD_DERIVED_KEY_BYTES, PBKDF2_ITERATIONS, SCRYPT_ALGORITHM, SCRYPT_MAXMEM, SCRYPT_N, SCRYPT_P, SCRYPT_R, parsePasswordHash, serializePbkdf2PasswordHash, serializeScryptPasswordHash } from "../src/password-format.js";
import { passwordHasher, verifyPassword } from "../src/password";

describe("production password hasher", () => {
  it("uses versioned scrypt with the approved parameters and a 32-byte key", async () => {
    const password = "correct-horse-battery-staple";
    const encoded = await passwordHasher.hash(password);
    const parsed = parsePasswordHash(encoded);
    expect(passwordHasher.algorithm).toBe(SCRYPT_ALGORITHM);
    expect(encoded).toMatch(/^scrypt-v1\$32768\$8\$3\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    expect(parsed?.algorithm).toBe(SCRYPT_ALGORITHM);
    expect(parsed?.derived).toHaveLength(PASSWORD_DERIVED_KEY_BYTES);
    await expect(passwordHasher.verify(password, encoded)).resolves.toBe(true);
    await expect(passwordHasher.verify("incorrect-password", encoded)).resolves.toBe(false);
    expect(encoded).not.toContain(password);
  });

  it("preserves special characters and UTF-8 without trimming", async () => {
    const password = " Ziyarat!ёж-42$ ";
    const encoded = await passwordHasher.hash(password);
    await expect(passwordHasher.verify(password, encoded)).resolves.toBe(true);
    await expect(passwordHasher.verify(password.trim(), encoded)).resolves.toBe(false);
  });

  it("fails closed for malformed hashes and invalid scrypt parameters", async () => {
    const valid = await passwordHasher.hash("Ziyarat-2026!parser");
    const invalid = [
      "not-a-password-hash",
      valid.replace(SCRYPT_ALGORITHM, "scrypt-v2"),
      valid.replace(`$${SCRYPT_N}$`, "$16384$"),
      valid.replace(`$${SCRYPT_R}$${SCRYPT_P}$`, "$4$1$"),
      `${SCRYPT_ALGORITHM}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$not+base64$derived`,
      `${SCRYPT_ALGORITHM}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$AQ$AQ`
    ];
    for (const encoded of invalid) {
      expect(parsePasswordHash(encoded)).toBeNull();
      await expect(passwordHasher.verify("Ziyarat-2026!parser", encoded)).resolves.toBe(false);
    }
  });

  it("rejects a stored hash paired with a different salt", async () => {
    const password = "Ziyarat-2026!salt";
    const encoded = await passwordHasher.hash(password);
    const parsed = parsePasswordHash(encoded);
    if (!parsed || parsed.algorithm !== SCRYPT_ALGORITHM) throw new Error("Expected scrypt hash");
    const differentSalt = Uint8Array.from({ length: 16 }, (_, index) => index + 31);
    const changed = serializeScryptPasswordHash(differentSalt, parsed.derived);
    await expect(passwordHasher.verify(password, changed)).resolves.toBe(false);
  });

  it("fails closed when native crypto raises an exception", async () => {
    const encoded = await passwordHasher.hash("Ziyarat-2026!crypto");
    const failure = await verifyPassword("Ziyarat-2026!crypto", encoded, async () => { throw new DOMException("Unavailable", "NotSupportedError"); });
    expect(failure).toEqual({ valid: false, status: "derive_failed", errorName: "NotSupportedError" });
  });
});

describe("bootstrap-to-Worker password flow", () => {
  it("verifies a Node bootstrap scrypt hash after D1-format storage", async () => {
    const password = "Ziyarat-2026!regression";
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const derived = scryptSync(password, salt, PASSWORD_DERIVED_KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM });
    const storedByD1 = String(serializeScryptPasswordHash(salt, derived));

    expect(storedByD1).toMatch(/^scrypt-v1\$32768\$8\$3\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    await expect(passwordHasher.verify(password, storedByD1)).resolves.toBe(true);
    await expect(passwordHasher.verify("Ziyarat-2026!wrong", storedByD1)).resolves.toBe(false);
  });

  it("retains the legacy PBKDF2 parser", () => {
    const password = "Ziyarat-2026!legacy";
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PASSWORD_DERIVED_KEY_BYTES, "sha256");
    const parsed = parsePasswordHash(serializePbkdf2PasswordHash(salt, derived));
    expect(parsed?.algorithm).toBe("pbkdf2-sha256-v1");
    expect(parsed?.derived).toHaveLength(PASSWORD_DERIVED_KEY_BYTES);
  });
});
