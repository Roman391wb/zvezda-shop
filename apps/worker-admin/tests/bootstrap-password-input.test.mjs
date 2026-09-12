import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { passwordFromChunks } from "../scripts/bootstrap-password-input.mjs";

describe("bootstrap raw password input", () => {
  it("removes terminal line endings received in the same chunk as a password", () => {
    expect(passwordFromChunks([Buffer.from("Ziyarat-2026!$\r")])).toBe("Ziyarat-2026!$");
    expect(passwordFromChunks([Buffer.from("Ziyarat-2026!$\r\n")])).toBe("Ziyarat-2026!$");
  });

  it("keeps special characters and UTF-8 split across raw TTY chunks", () => {
    const password = "Ziyarat!ёж-42";
    const bytes = Buffer.from(`${password}\n`);
    expect(passwordFromChunks([bytes.subarray(0, 10), bytes.subarray(10, 13), bytes.subarray(13)])).toBe(password);
  });
});
