import { describe, expect, it } from "vitest";
import type { Config } from "../src/config";
import { AppError } from "../src/errors";
import { GitHubWriter } from "../src/github-writer";
import { CONTENT_PATHS } from "../src/types";

const encoder = new TextEncoder();
const config = async (): Promise<Config> => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return { environment: "production", allowedOrigins: new Set(["https://shop.example.com"]), githubOwner: "owner", githubRepo: "repo", githubRef: "main", writesEnabled: true, githubAppId: "123", githubInstallationId: "456", githubAppPrivateKey: `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`, ipHashPepper: "pepper" };
};
const installation = () => new Response(JSON.stringify({ token: "installation-token-not-returned", expires_at: "2030-01-01T00:00:00Z" }));

describe("GitHubWriter", () => {
  it("uses the Git data API and explicitly performs a non-force ref update", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const writer = new GitHubWriter(await config(), async (url, init) => {
      requests.push({ url: String(url), init }); const value = String(url);
      if (value.includes("/access_tokens")) return installation();
      if (value.includes("/git/ref/heads/")) return new Response(JSON.stringify({ object: { sha: "head-sha" } }));
      if (value.includes(`/contents/${CONTENT_PATHS.products}`)) return new Response(JSON.stringify({ encoding: "base64", content: btoa(JSON.stringify({ products: [] })), sha: "products-sha" }));
      if (value.endsWith("/git/commits/head-sha")) return new Response(JSON.stringify({ tree: { sha: "tree-sha" } }));
      if (value.endsWith("/git/blobs")) return new Response(JSON.stringify({ sha: "blob-sha" }));
      if (value.endsWith("/git/trees")) return new Response(JSON.stringify({ sha: "new-tree-sha" }));
      if (value.endsWith("/git/commits")) return new Response(JSON.stringify({ sha: "new-commit-sha" }));
      if (value.includes("/git/refs/heads/")) return new Response("{}", { status: 200 });
      throw new Error(`unexpected ${value}`);
    });
    const result = await writer.commit([{ path: CONTENT_PATHS.products, bytes: encoder.encode(JSON.stringify({ products: [] })) }], { message: "admin: test", expectedRevisions: { products: "products-sha" } });
    expect(result.commitSha).toBe("new-commit-sha"); const ref = requests.find((item) => item.url.includes("/git/refs/heads/") && item.init?.method === "PATCH"); expect(JSON.parse(String(ref?.init?.body))).toEqual({ sha: "new-commit-sha", force: false });
  });

  it("maps GitHub auth, rate limit, availability, stale branch and ref conflicts without exposing the installation token", async () => {
    const cfg = await config();
    await expect(new GitHubWriter(cfg, async () => new Response("forbidden", { status: 403 })).readByKey("products")).rejects.toMatchObject({ code: "github_auth_error" });
    await expect(new GitHubWriter(cfg, async () => { throw new Error("network"); }).readByKey("products")).rejects.toMatchObject({ code: "github_unavailable" });
    let rateCall = 0; const rate = new GitHubWriter(cfg, async () => { rateCall += 1; return rateCall === 1 ? installation() : new Response("slow", { status: 429, headers: { "X-RateLimit-Remaining": "0" } }); });
    await expect(rate.readByKey("products")).rejects.toMatchObject({ code: "github_rate_limited" });
    let branchCall = 0; const stale = new GitHubWriter(cfg, async () => { branchCall += 1; return branchCall === 1 ? installation() : new Response(JSON.stringify({ object: { sha: "new-head" } })); });
    await expect(stale.commit([{ path: CONTENT_PATHS.products, bytes: encoder.encode("{}") }], { message: "admin", expectedHead: "old-head" })).rejects.toMatchObject({ status: 409, code: "CONTENT_CONFLICT" });
    let partialCall = 0; const partial = new GitHubWriter(cfg, async () => { partialCall += 1; if (partialCall === 1) return installation(); if (partialCall === 2) return new Response(JSON.stringify({ object: { sha: "head" } })); return new Response("{}"); });
    await expect(partial.commit([{ path: CONTENT_PATHS.products, bytes: encoder.encode("{}") }], { message: "admin", expectedHead: "head" })).rejects.toMatchObject({ code: "github_invalid_response" });
    const calls: string[] = []; const conflict = new GitHubWriter(cfg, async (url, init) => { const value = String(url); calls.push(value); if (value.includes("/access_tokens")) return installation(); if (value.includes("/git/ref/heads/") && init?.method !== "PATCH") return new Response(JSON.stringify({ object: { sha: "head" } })); if (value.includes(`/contents/${CONTENT_PATHS.products}`)) return new Response(JSON.stringify({ encoding: "base64", content: btoa(JSON.stringify({ products: [] })), sha: "fresh-sha" })); if (value.endsWith("/git/commits/head")) return new Response(JSON.stringify({ tree: { sha: "tree" } })); if (value.endsWith("/git/blobs")) return new Response(JSON.stringify({ sha: "blob" })); if (value.endsWith("/git/trees")) return new Response(JSON.stringify({ sha: "tree2" })); if (value.endsWith("/git/commits")) return new Response(JSON.stringify({ sha: "commit" })); if (value.includes("/git/refs/heads/") && init?.method === "PATCH") return new Response("conflict", { status: 409 }); throw new Error(value); });
    let error: AppError | null = null;
    try { await conflict.commit([{ path: CONTENT_PATHS.products, bytes: encoder.encode("{}") }], { message: "admin", expectedRevisions: { products: "fresh-sha" } }); } catch (value) { error = value as AppError; }
    expect(error?.code).toBe("CONTENT_CONFLICT"); expect(new Headers(error?.headers).get("ETag")).toBe('"fresh-sha"'); expect(JSON.stringify(error)).not.toContain("installation-token-not-returned"); expect(calls.filter((url) => url.includes(`/contents/${CONTENT_PATHS.products}`))).toHaveLength(2);
  });
});
