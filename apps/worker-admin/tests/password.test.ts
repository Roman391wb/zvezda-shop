import { describe, expect, it } from "vitest";
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
