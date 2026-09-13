import { AppError } from "./errors";
import type { Config } from "./config";
import { GitHubAppAuth, type GitHubTokenProvider } from "./github-app-auth";
import { assertGitHubResponse, githubFetch, githubHeaders } from "./github-api";
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
    const url = `https://api.github.com/repos/${encodeURIComponent(this.config.githubOwner)}/${encodeURIComponent(this.config.githubRepo)}/contents/${path}?ref=${encodeURIComponent(this.config.githubRef)}`;
    const response = await githubFetch(this.requestFetch, "content_read", url, { headers: githubHeaders(token) });
    assertGitHubResponse(response, "content_read");
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
