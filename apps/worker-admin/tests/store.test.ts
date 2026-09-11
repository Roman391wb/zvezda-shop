import { describe, expect, it } from "vitest";
import { D1AdminStore } from "../src/store";

describe("D1AdminStore", () => {
  it("binds exactly the 16 parameters used by the login-attempt UPSERT", async () => {
    const bindings: unknown[][] = [];
    const statement = {
      bind(...values: unknown[]) { bindings.push(values); return statement; },
      async run() { return { success: true, meta: {} }; },
      async first<T>() { return null as T | null; }
    };
    const database = { prepare: () => statement } as unknown as D1Database;

    await expect(new D1AdminStore(database).recordAttempt("attempt-key", 1_700_000_000_000)).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(bindings[0]).toHaveLength(16);
  });
});
