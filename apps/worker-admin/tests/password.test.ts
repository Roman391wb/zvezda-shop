import { describe, expect, it } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import { PASSWORD_ALGORITHM, PASSWORD_ITERATIONS, parsePasswordHash, serializePasswordHash } from "../src/password-format.js";
import { passwordHasher } from "../src/password";

describe("production password hasher", () => {
  it("uses versioned PBKDF2-SHA-256 with 600,000 iterations", async () => {
    const encoded = await passwordHasher.hash("correct-horse-battery-staple");
    expect(passwordHasher.algorithm).toBe("pbkdf2-sha256-v1");
    expect(encoded).toMatch(/^pbkdf2-sha256-v1\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    await expect(passwordHasher.verify("correct-horse-battery-staple", encoded)).resolves.toBe(true);
    await expect(passwordHasher.verify("incorrect-password", encoded)).resolves.toBe(false);
    expect(encoded).not.toContain("correct-horse-battery-staple");
  });
});

describe("bootstrap-to-Worker password flow", () => {
  it("verifies a Node bootstrap hash after D1-format storage", async () => {
    const password = "Ziyarat-2026!regression";
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const derived = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
    const storedByD1 = String(serializePasswordHash(salt, derived));

    expect(storedByD1).toMatch(/^pbkdf2-sha256-v1\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
    await expect(passwordHasher.verify(password, storedByD1)).resolves.toBe(true);
    await expect(passwordHasher.verify("Ziyarat-2026!wrong", storedByD1)).resolves.toBe(false);
  });

  it("rejects malformed password encodings before deriving", async () => {
    const valid = await passwordHasher.hash("Ziyarat-2026!parser");
    const invalid = [
      "not-a-password-hash",
      valid.replace(PASSWORD_ALGORITHM, "pbkdf2-sha512-v1"),
      valid.replace(`$${PASSWORD_ITERATIONS}$`, "$0$"),
      `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$not+base64$derived`,
      `${PASSWORD_ALGORITHM}$${PASSWORD_ITERATIONS}$AQ$AQ`
    ];
    for (const encoded of invalid) {
      expect(parsePasswordHash(encoded)).toBeNull();
      await expect(passwordHasher.verify("Ziyarat-2026!parser", encoded)).resolves.toBe(false);
    }
  });
});
