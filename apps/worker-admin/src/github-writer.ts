import type { Config } from "./config";
import { AppError } from "./errors";
import { GitHubAppAuth } from "./github-app-auth";
import { assertGitHubResponse, githubFetch, githubHeaders } from "./github-api";
import { CONTENT_PATHS, UPLOADS_PREFIX, type ContentKey, type ContentPath, type GitCommitChange, type GitCommitResult, type GitHubDocument, type GitUploadAsset, type UploadPath, type WritePath } from "./types";

const decoder = new TextDecoder();
const contentPathSet = new Set<string>(Object.values(CONTENT_PATHS));

export interface GitWriterPort {
  head(): Promise<string>;
  readByKey(key: ContentKey): Promise<GitHubDocument>;
  readByKeyAt(key: ContentKey, ref: string): Promise<GitHubDocument>;
  commit(changes: GitCommitChange[], input: { message: string; expectedRevisions?: Partial<Record<ContentKey, string>>; expectedHead?: string }): Promise<GitCommitResult>;
  listUploads(): Promise<GitUploadAsset[]>;
  workflowForCommit(commitSha: string): Promise<{ status: string; conclusion: string | null; url: string | null } | null>;
  history(key: ContentKey): Promise<{ sha: string; message: string; createdAt: string }[]>;
}

function isUploadPath(path: string): path is UploadPath {
  return path.startsWith(UPLOADS_PREFIX) && /^apps\/web\/public\/uploads\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/u.test(path);
}

export function assertWritePath(path: string): asserts path is WritePath {
  if (!contentPathSet.has(path) && !isUploadPath(path)) throw new AppError(403, "path_not_allowed", "Этот Git path не разрешён");
}

function base64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function keyForPath(path: WritePath): ContentKey | null {
  return (Object.keys(CONTENT_PATHS) as ContentKey[]).find((key) => CONTENT_PATHS[key] === path) ?? null;
}

export class GitHubWriter implements GitWriterPort {
  private readonly auth: GitHubAppAuth;

  constructor(private readonly config: Config, private readonly requestFetch: typeof fetch = fetch) {
    this.auth = new GitHubAppAuth(config, requestFetch);
  }

  async readByKey(key: ContentKey): Promise<GitHubDocument> {
    return this.readDocument(CONTENT_PATHS[key], this.config.githubRef);
  }

  async head(): Promise<string> { return this.branchHead(); }

  async readByKeyAt(key: ContentKey, ref: string): Promise<GitHubDocument> {
    if (!/^[0-9a-f]{7,64}$/iu.test(ref)) throw new AppError(422, "validation_error", "Некорректный commit SHA");
    return this.readDocument(CONTENT_PATHS[key], ref);
  }

  async commit(changes: GitCommitChange[], input: { message: string; expectedRevisions?: Partial<Record<ContentKey, string>>; expectedHead?: string }): Promise<GitCommitResult> {
    if (!changes.length) throw new AppError(422, "validation_error", "Нет изменений для сохранения");
    changes.forEach((change) => assertWritePath(change.path));
    const head = await this.branchHead();
    if (input.expectedHead && input.expectedHead !== head) throw await this.contentConflict();
    const revisions: Partial<Record<ContentKey, string>> = {};
    for (const [key, expected] of Object.entries(input.expectedRevisions ?? {}) as [ContentKey, string][]) {
      const current = await this.readDocument(CONTENT_PATHS[key], head);
      if (current.sha !== expected) throw await this.contentConflict(key);
      revisions[key] = current.sha;
    }
    const commitResponse = await this.api(`/repos/${this.repository()}/git/commits/${head}`);
    const parent = await commitResponse.json() as { tree?: { sha?: string } };
    if (!parent.tree?.sha) throw new AppError(502, "github_invalid_response", "GitHub не вернул tree branch head");
    const treeEntries: { path: WritePath; mode: "100644"; type: "blob"; sha: string | null }[] = [];
    for (const change of changes) {
      if (change.bytes === null) { treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: null }); continue; }
      const blob = await this.api(`/repos/${this.repository()}/git/blobs`, { method: "POST", body: JSON.stringify({ content: base64(change.bytes), encoding: "base64" }) });
      const payload = await blob.json() as { sha?: string };
      if (!payload.sha) throw new AppError(502, "github_invalid_response", "GitHub не вернул blob SHA");
      treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: payload.sha });
      const key = keyForPath(change.path); if (key) revisions[key] = payload.sha;
    }
    const tree = await this.api(`/repos/${this.repository()}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree: treeEntries }) });
    const treePayload = await tree.json() as { sha?: string };
    if (!treePayload.sha) throw new AppError(502, "github_invalid_response", "GitHub не вернул tree SHA");
    const commit = await this.api(`/repos/${this.repository()}/git/commits`, { method: "POST", body: JSON.stringify({ message: input.message, tree: treePayload.sha, parents: [head] }) });
    const commitPayload = await commit.json() as { sha?: string };
    if (!commitPayload.sha) throw new AppError(502, "github_invalid_response", "GitHub не вернул commit SHA");
    try { await this.api(`/repos/${this.repository()}/git/refs/heads/${encodeURIComponent(this.config.githubRef)}`, { method: "PATCH", body: JSON.stringify({ sha: commitPayload.sha, force: false }) }); }
    catch (error) { if (error instanceof AppError && error.code === "github_ref_conflict") { const key = Object.keys(input.expectedRevisions ?? {})[0] as ContentKey | undefined; throw await this.contentConflict(key); } throw error; }
    return { commitSha: commitPayload.sha, revisions };
  }

  async listUploads(): Promise<GitUploadAsset[]> {
    const head = await this.branchHead();
    const commit = await this.api(`/repos/${this.repository()}/git/commits/${head}`);
    const commitPayload = await commit.json() as { tree?: { sha?: string } };
    if (!commitPayload.tree?.sha) throw new AppError(502, "github_invalid_response", "GitHub не вернул tree SHA");
    const tree = await this.api(`/repos/${this.repository()}/git/trees/${commitPayload.tree.sha}?recursive=1`);
    const payload = await tree.json() as { tree?: { path?: string; type?: string }[] };
    return (payload.tree ?? []).flatMap((entry) => {
      if (entry.type !== "blob" || !entry.path || !isUploadPath(entry.path)) return [];
      const filename = entry.path.slice(UPLOADS_PREFIX.length);
      return [{ id: filename.replace(/\.(jpg|png|webp)$/u, ""), path: entry.path, url: `/${entry.path.replace("apps/web/public/", "")}` }];
    });
  }

  async workflowForCommit(commitSha: string): Promise<{ status: string; conclusion: string | null; url: string | null } | null> {
    const response = await this.api(`/repos/${this.repository()}/actions/runs?head_sha=${encodeURIComponent(commitSha)}&per_page=1`);
    const payload = await response.json() as { workflow_runs?: { status?: string; conclusion?: string | null; html_url?: string }[] };
    const run = payload.workflow_runs?.[0];
    return run?.status ? { status: run.status, conclusion: run.conclusion ?? null, url: run.html_url ?? null } : null;
  }

  async history(key: ContentKey): Promise<{ sha: string; message: string; createdAt: string }[]> {
    const response = await this.api(`/repos/${this.repository()}/commits?path=${encodeURIComponent(CONTENT_PATHS[key])}&sha=${encodeURIComponent(this.config.githubRef)}&per_page=30`);
    const payload = await response.json() as { sha?: string; commit?: { message?: string; author?: { date?: string } } }[];
    return payload.flatMap((item) => item.sha && item.commit?.message && item.commit.author?.date ? [{ sha: item.sha, message: item.commit.message, createdAt: item.commit.author.date }] : []);
  }

  private async readDocument(path: ContentPath, ref: string): Promise<GitHubDocument> {
    const response = await this.api(`/repos/${this.repository()}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    const payload = await response.json() as { content?: string; encoding?: string; sha?: string };
    if (payload.encoding !== "base64" || !payload.content || !payload.sha) throw new AppError(502, "github_invalid_response", "Некорректный ответ GitHub");
    try { return { path, sha: payload.sha, value: JSON.parse(decoder.decode(decodeBase64(payload.content))) }; }
    catch { throw new AppError(502, "content_invalid_json", `Файл ${path} содержит некорректный JSON`); }
  }

  private async branchHead(): Promise<string> {
    const response = await this.api(`/repos/${this.repository()}/git/ref/heads/${encodeURIComponent(this.config.githubRef)}`);
    const payload = await response.json() as { object?: { sha?: string } };
    if (!payload.object?.sha) throw new AppError(502, "github_invalid_response", "GitHub не вернул branch head");
    return payload.object.sha;
  }

  private repository(): string {
    if (!this.config.githubOwner || !this.config.githubRepo || !/^[A-Za-z0-9._-]+$/u.test(this.config.githubOwner) || !/^[A-Za-z0-9._-]+$/u.test(this.config.githubRepo) || !/^[A-Za-z0-9._/-]+$/u.test(this.config.githubRef)) throw new AppError(503, "github_write_not_configured", "GitHub repository для записи не настроен");
    return `${encodeURIComponent(this.config.githubOwner)}/${encodeURIComponent(this.config.githubRepo)}`;
  }

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.auth.installationToken();
    const url = `https://api.github.com${path}`;
    const response = await githubFetch(this.requestFetch, "repository_api", url, { ...init, headers: githubHeaders(token, { "Content-Type": "application/json", ...init.headers }) });
    if (response.status === 409 || response.status === 422 && path.includes("/git/refs/")) throw new AppError(409, "github_ref_conflict", "GitHub branch изменился");
    if (response.status === 429 || response.headers.get("X-RateLimit-Remaining") === "0") throw new AppError(503, "github_rate_limited", "GitHub rate limit исчерпан");
    assertGitHubResponse(response, "repository_api");
    return response;
  }

  private async contentConflict(key?: ContentKey): Promise<AppError> {
    const revision = key ? (await this.readByKey(key)).sha : undefined;
    return new AppError(409, "CONTENT_CONFLICT", "Контент изменился. Обновите данные и повторите операцию.", revision ? { ETag: `"${revision}"` } : undefined);
  }
}
