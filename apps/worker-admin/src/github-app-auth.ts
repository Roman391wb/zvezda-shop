import type { Config } from "./config";
import { toBase64Url } from "./crypto";
import { AppError } from "./errors";
import { assertGitHubResponse, githubFetch, githubHeaders } from "./github-api";

const encoder = new TextEncoder();

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export interface GitHubTokenProvider {
  installationToken(): Promise<string>;
}

export class GitHubAppAuth implements GitHubTokenProvider {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: Config, private readonly requestFetch: typeof fetch = fetch) {}

  async installationToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;
    const appId = this.config.githubAppId?.trim();
    const installationId = this.config.githubInstallationId?.trim();
    const privateKey = this.config.githubAppPrivateKey;
    if (!appId || !installationId || !privateKey) throw new AppError(503, "github_app_not_configured", "GitHub App не настроен");
    const jwt = await this.appJwt(appId, privateKey);
    const payload = await this.issueToken(jwt, installationId, "access_token");
    this.token = { value: payload.token, expiresAt: Date.parse(payload.expires_at) };
    return this.token.value;
  }

  private async issueToken(jwt: string, installationId: string, stage: string): Promise<{ token: string; expires_at: string }> {
    const url = `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`;
    const response = await githubFetch(this.requestFetch, stage, url, { method: "POST", headers: githubHeaders(jwt) });
    assertGitHubResponse(response, stage);
    let payload: { token?: unknown; expires_at?: unknown };
    try { payload = await response.json() as { token?: unknown; expires_at?: unknown }; }
    catch { throw new AppError(502, "github_provider_error", `${stage}: GitHub вернул некорректный JSON`); }
    if (typeof payload.token !== "string" || !payload.token || typeof payload.expires_at !== "string" || Number.isNaN(Date.parse(payload.expires_at))) {
      throw new AppError(502, "github_provider_error", `${stage}: GitHub не вернул корректный installation token`);
    }
    return { token: payload.token, expires_at: payload.expires_at };
  }

  private async appJwt(appId: string, privateKey: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const payload = toBase64Url(encoder.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })));
    const pem = privateKey.replaceAll("\\n", "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey("pkcs8", decodeBase64(pem).buffer as ArrayBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    } catch (error) {
      console.info(JSON.stringify({ event: "github.stage", stage: "app_jwt", http_status: null, response_classification: "local_error", error_name: error instanceof Error ? error.name : "unknown", safe_error_message: "Не удалось импортировать private key" }));
      throw new AppError(503, "github_app_not_configured", "Некорректный private key GitHub App");
    }
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${payload}`));
    console.info(JSON.stringify({ event: "github.stage", stage: "app_jwt", http_status: null, response_classification: "success" }));
    return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
  }
}
