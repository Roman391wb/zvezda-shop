import { beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../src/config";
import { GitHubAppAuth } from "../src/github-app-auth";

let config: Config;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  config = {
    environment: "staging",
    allowedOrigins: new Set(["https://ziyarat-admin-staging.pages.dev"]),
    githubOwner: "owner",
    githubRepo: "repo",
    githubRef: "admin-staging",
    writesEnabled: false,
    githubAppId: "123",
    githubInstallationId: "456",
    githubAppPrivateKey: `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`,
    ipHashPepper: "pepper"
  };
});

describe("GitHubAppAuth token format", () => {
  it.each([
    ["classic", "ghs_short-token"],
    ["stateless", `ghs_${"a".repeat(170)}.${"b".repeat(170)}.${"c".repeat(170)}`],
    ["long", `token-${"z".repeat(520)}`],
    ["punctuation", "ghs_segment-one_segment.two-three.final_part"]
  ])("accepts %s installation token as opaque", async (_name, token) => {
    const auth = new GitHubAppAuth(config, async () => new Response(JSON.stringify({ token, expires_at: "2030-01-01T00:00:00Z" })));
    await expect(auth.installationToken()).resolves.toBe(token);
  });
});
