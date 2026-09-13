import { describe, expect, it } from "vitest";
import { assertGitHubResponse, githubFetch, githubHeaders, tokenMetadata } from "../src/github-api";

describe("GitHub API safety", () => {
  it.each([
    ["old short token", "short-installation-token"],
    ["new stateless ghs_ token", `ghs_${"a".repeat(160)}.${"b".repeat(160)}.${"c".repeat(190)}`],
    ["token over 500 characters", `opaque-${"x".repeat(520)}`],
    ["token with dots, hyphen and underscore", "opaque.part-one_part-two.final"]
  ])("treats %s as an opaque string", (_name, token) => {
    const headers = githubHeaders(token);
    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("User-Agent")).toBe("zvezda-admin-staging");
    expect(headers.get("X-GitHub-Api-Version")).toBe("2026-03-10");
  });

  it("reports token metadata without returning the token", () => {
    const token = `ghs_${"a".repeat(200)}.${"b".repeat(160)}.${"c".repeat(160)}`;
    const metadata = tokenMetadata(token);
    expect(metadata).toEqual({ token_returned: true, token_prefix_is_ghs: true, token_length: token.length, contains_two_dots_after_prefix: true });
    expect(JSON.stringify(metadata)).not.toContain(token);
  });

  it.each([
    [401, "github_authentication_failed"],
    [403, "github_forbidden"],
    [404, "github_not_found_or_no_access"],
    [422, "github_request_invalid"],
    [500, "github_provider_error"]
  ])("preserves GitHub HTTP %i classification", (status, code) => {
    expect(() => assertGitHubResponse(new Response(null, { status }), "test_stage")).toThrowError(expect.objectContaining({ code }));
  });

  it("classifies a fetch throw and invokes fetch without an object receiver", async () => {
    const capture: { receiver: unknown } = { receiver: "unset" };
    const requestFetch = function (this: unknown): Promise<Response> {
      capture.receiver = this;
      throw new TypeError("network failed ghs_secret.must.not-leak");
    } as typeof fetch;
    await expect(githubFetch(requestFetch, "test_stage", "https://api.github.com/app?ignored=true", {})).rejects.toMatchObject({ code: "github_unavailable" });
    expect(capture.receiver).toBeUndefined();
  });
});
