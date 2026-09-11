import type { Config } from "./config";
import { toBase64Url } from "./crypto";
import { AppError } from "./errors";

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
    let response: Response;
    try {
      response = await this.requestFetch(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "X-GitHub-Api-Version": "2022-11-28" }
      });
    } catch { throw new AppError(503, "github_unavailable", "GitHub временно недоступен"); }
    if (response.status === 401 || response.status === 403) throw new AppError(502, "github_auth_error", "GitHub App не авторизован");
    if (!response.ok) throw new AppError(503, "github_unavailable", "Не удалось получить GitHub installation token");
    const payload = await response.json() as { token?: string; expires_at?: string };
    if (!payload.token || !payload.expires_at || Number.isNaN(Date.parse(payload.expires_at))) throw new AppError(502, "github_invalid_response", "Некорректный ответ GitHub");
    this.token = { value: payload.token, expiresAt: Date.parse(payload.expires_at) };
    return this.token.value;
  }

  private async appJwt(appId: string, privateKey: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const payload = toBase64Url(encoder.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })));
    const pem = privateKey.replaceAll("\\n", "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey("pkcs8", decodeBase64(pem).buffer as ArrayBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    } catch { throw new AppError(503, "github_app_not_configured", "Некорректный private key GitHub App"); }
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${payload}`));
    return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
  }
}
