import { AppError } from "./errors";
import type { Config } from "./config";
import { GitHubAppAuth, type GitHubTokenProvider } from "./github-app-auth";
import { CONTENT_PATHS, type ContentKey, type ContentPath, type GitHubDocument } from "./types";

const pathValues = new Set<string>(Object.values(CONTENT_PATHS));

export class GitHubReader {
  private readonly auth: GitHubTokenProvider;

  constructor(private readonly config: Config, private readonly requestFetch: typeof fetch = fetch, auth?: GitHubTokenProvider) {
    this.auth = auth ?? new GitHubAppAuth(config, requestFetch);
  }

  async readByKey(key: ContentKey): Promise<GitHubDocument> { return this.read(CONTENT_PATHS[key]); }

  async read(path: ContentPath): Promise<GitHubDocument> {
    if (!pathValues.has(path)) throw new AppError(404, "content_not_found", "Неизвестный документ контента");
    if (!this.config.githubOwner || !this.config.githubRepo) throw new AppError(503, "github_not_configured", "GitHub Reader не настроен");
    const token = await this.auth.installationToken();
    let response: Response;
    try {
      response = await this.requestFetch(`https://api.github.com/repos/${encodeURIComponent(this.config.githubOwner)}/${encodeURIComponent(this.config.githubRepo)}/contents/${path}?ref=${encodeURIComponent(this.config.githubRef)}`, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }
      });
    } catch { throw new AppError(503, "github_unavailable", "GitHub временно недоступен"); }
    if (response.status === 401 || response.status === 403) throw new AppError(502, "github_auth_error", "GitHub Reader не авторизован");
    if (!response.ok) throw new AppError(503, "github_unavailable", "Не удалось прочитать контент из GitHub");
    let payload: { content?: string; encoding?: string; sha?: string };
    try { payload = await response.json() as { content?: string; encoding?: string; sha?: string }; } catch { throw new AppError(502, "github_invalid_response", "Некорректный ответ GitHub"); }
    if (payload.encoding !== "base64" || !payload.content || !payload.sha) throw new AppError(502, "github_invalid_response", "Некорректный ответ GitHub");
    try {
      const binary = atob(payload.content.replace(/\s/g, ""));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return { path, sha: payload.sha, value: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch { throw new AppError(502, "content_invalid_json", `Файл ${path} содержит некорректный JSON`); }
  }
}
