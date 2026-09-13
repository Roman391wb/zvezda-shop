import { AppError } from "./errors";

export const GITHUB_API_VERSION = "2026-03-10";
export const GITHUB_USER_AGENT = "zvezda-admin-staging";

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const value = error.message
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/ghs_[A-Za-z0-9._-]+/gu, "ghs_[redacted]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu, "[jwt redacted]");
  return value.slice(0, 200) || error.name;
}

function location(url: string): { hostname: string; path: string } {
  const parsed = new URL(url);
  return { hostname: parsed.hostname, path: parsed.pathname };
}

function logStage(stage: string, url: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ event: "github.stage", stage, ...location(url), ...fields }));
}

export function githubHeaders(authorization: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${authorization}`);
  headers.set("User-Agent", GITHUB_USER_AGENT);
  headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
  return headers;
}

export async function githubFetch(requestFetch: typeof fetch, stage: string, url: string, init: RequestInit): Promise<Response> {
  try {
    // Cloudflare's native fetch must be called as a function. Calling it through
    // an object property can bind an incompatible receiver and throw before I/O.
    const invoke = requestFetch;
    const response = await invoke(url, init);
    logStage(stage, url, { http_status: response.status, response_classification: response.ok ? "success" : "http_error" });
    return response;
  } catch (error) {
    logStage(stage, url, {
      http_status: null,
      response_classification: "network_exception",
      error_name: error instanceof Error ? error.name : "unknown",
      safe_error_message: safeErrorMessage(error)
    });
    throw new AppError(503, "github_unavailable", `${stage}: GitHub недоступен`);
  }
}

export function assertGitHubResponse(response: Response, stage: string): void {
  if (response.ok) return;
  if (response.status === 401) throw new AppError(502, "github_authentication_failed", `${stage}: GitHub отклонил аутентификацию`);
  if (response.status === 403) throw new AppError(502, "github_forbidden", `${stage}: GitHub запретил операцию`);
  if (response.status === 404) throw new AppError(502, "github_not_found_or_no_access", `${stage}: ресурс не найден или недоступен`);
  if (response.status === 422) throw new AppError(502, "github_request_invalid", `${stage}: GitHub отклонил параметры запроса`);
  throw new AppError(502, "github_provider_error", `${stage}: неожиданный ответ GitHub (${response.status})`);
}

export function tokenMetadata(token: string): { token_returned: boolean; token_prefix_is_ghs: boolean; token_length: number; contains_two_dots_after_prefix: boolean } {
  const prefix = token.startsWith("ghs_");
  const opaque = prefix ? token.slice(4) : token;
  return {
    token_returned: token.length > 0,
    token_prefix_is_ghs: prefix,
    token_length: token.length,
    contains_two_dots_after_prefix: (opaque.match(/\./gu) ?? []).length === 2
  };
}
