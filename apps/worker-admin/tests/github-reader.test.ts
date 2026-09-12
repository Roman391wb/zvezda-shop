import { describe, expect, it } from "vitest";
import { GitHubReader } from "../src/github-reader";

const config = {
  environment: "production" as const,
  allowedOrigins: new Set(["https://shop.example.com"]),
  githubOwner: "owner",
  githubRepo: "repo",
  githubRef: "main",
  githubAppId: "123",
  githubInstallationId: "456",
  githubAppPrivateKey: "unused-in-test",
  writesEnabled: false,
  ipHashPepper: "pepper"
};

describe("GitHubReader", () => {
  it("maps malformed JSON without exposing the GitHub token", async () => {
    const reader = new GitHubReader(config, async () => new Response(JSON.stringify({ encoding: "base64", sha: "sha", content: btoa("not-json") })), { installationToken: async () => "installation-token" });
    await expect(reader.readByKey("products")).rejects.toMatchObject({ status: 502, code: "content_invalid_json" });
  });

  it("maps GitHub authentication and availability failures", async () => {
    const forbidden = new GitHubReader(config, async () => new Response("forbidden", { status: 403 }), { installationToken: async () => "installation-token" });
    await expect(forbidden.readByKey("settings")).rejects.toMatchObject({ status: 502, code: "github_forbidden" });
    const unavailable = new GitHubReader(config, async () => { throw new Error("network unavailable"); }, { installationToken: async () => "installation-token" });
    await expect(unavailable.readByKey("settings")).rejects.toMatchObject({ status: 503, code: "github_unavailable" });
  });
});
