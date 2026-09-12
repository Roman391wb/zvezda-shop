import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { createApp } from "../src/index";
import { passwordHasher, type PasswordHasher } from "../src/password";
import type { AdminStore, AuditInput, IdempotencyState, SessionInput } from "../src/store";
import type { AdminSession, AdminUser, ContentKey, Env, GitHubDocument } from "../src/types";

const now = Date.now();
const admin = (): AdminUser => ({ id: "admin-1", loginNormalized: "admin", displayLogin: "admin", passwordHash: "correct-password", passwordAlgorithm: "test", role: "ADMIN", isActive: true, sessionVersion: 1, passwordChangedAt: now, lastLoginAt: null, createdAt: now, updatedAt: now });
const moderator = (): AdminUser => ({ ...admin(), id: "moderator-1", loginNormalized: "moderator", displayLogin: "moderator", role: "MODERATOR" });

class MemoryStore implements AdminStore {
  users = new Map<string, AdminUser>();
  sessions = new Map<string, AdminSession>();
  attempts = new Map<string, number>();
  auditEvents: AuditInput[] = [];
  idempotency = new Map<string, { requestHash: string; status: "PENDING" | "COMPLETED" | "FAILED"; response?: unknown; responseStatus?: number }>();
  publishJobs: Record<string, unknown>[] = [];
  constructor(...users: AdminUser[]) { users.forEach((user) => this.users.set(user.id, user)); }
  async findUserByLogin(login: string) { return [...this.users.values()].find((user) => user.loginNormalized === login) ?? null; }
  async findUserById(id: string) { return this.users.get(id) ?? null; }
  async markUserLoggedIn(id: string, updatedAt: number) { const user = this.users.get(id); if (user) user.lastLoginAt = updatedAt; }
  async createSession(input: SessionInput) { this.sessions.set(input.id, { ...input, lastSeenAt: input.createdAt, revokedAt: null }); }
  async findSession(id: string) { return this.sessions.get(id) ?? null; }
  async touchSession(id: string, updatedAt: number) { const session = this.sessions.get(id); if (session) session.lastSeenAt = updatedAt; }
  async revokeSession(id: string, revokedAt: number) { const session = this.sessions.get(id); if (session) session.revokedAt ??= revokedAt; }
  async revokeUserSessions(userId: string, revokedAt: number) { for (const session of this.sessions.values()) if (session.userId === userId) session.revokedAt ??= revokedAt; }
  async changePassword(userId: string, passwordHash: string, passwordAlgorithm: string, updatedAt: number) { const user = this.users.get(userId); if (user) { user.passwordHash = passwordHash; user.passwordAlgorithm = passwordAlgorithm; user.sessionVersion += 1; user.passwordChangedAt = updatedAt; } await this.revokeUserSessions(userId, updatedAt); }
  async recordAttempt(keyHash: string) { const value = (this.attempts.get(keyHash) ?? 0) + 1; this.attempts.set(keyHash, value); return value > 8 ? { allowed: false, retryAfterSeconds: 900 } : { allowed: true, retryAfterSeconds: 0 }; }
  async clearAttempts(keyHash: string) { this.attempts.delete(keyHash); }
  async audit(input: AuditInput) { this.auditEvents.push(input); }
  async beginIdempotency(input: { actorUserId: string; operation: string; keyHash: string; requestHash: string }): Promise<IdempotencyState> {
    const key = `${input.actorUserId}:${input.operation}:${input.keyHash}`; const existing = this.idempotency.get(key);
    if (!existing) { this.idempotency.set(key, { requestHash: input.requestHash, status: "PENDING" }); return { kind: "new" }; }
    if (existing.requestHash !== input.requestHash) return { kind: "conflict" };
    if (existing.status === "PENDING") return { kind: "pending" };
    if (existing.status === "FAILED") return { kind: "failed", status: existing.responseStatus ?? 500, response: existing.response ?? {} };
    return { kind: "completed", status: existing.responseStatus ?? 500, response: existing.response ?? {} };
  }
  async completeIdempotency(input: { actorUserId: string; operation: string; keyHash: string; status: number; response: unknown }) { const key = `${input.actorUserId}:${input.operation}:${input.keyHash}`; const current = this.idempotency.get(key); if (current) Object.assign(current, { status: "COMPLETED", responseStatus: input.status, response: input.response }); }
  async failIdempotency(input: { actorUserId: string; operation: string; keyHash: string; status: number; response: unknown }) { const key = `${input.actorUserId}:${input.operation}:${input.keyHash}`; const current = this.idempotency.get(key); if (current) Object.assign(current, { status: "FAILED", responseStatus: input.status, response: input.response }); }
  async createPublishJob(input: { actorUserId: string; commitSha: string; paths: string[]; now: number }) { this.publishJobs.push({ github_commit_sha: input.commitSha, status: "awaiting_run", paths_json: JSON.stringify(input.paths), created_at: input.now }); }
  async inventoryHistory(productId: string) { return this.auditEvents.filter((event) => event.action === "inventory.adjusted" && event.metadata?.product_id === productId).map((event) => ({ ...event })); }
  async publishJob(commitSha: string) { return this.publishJobs.find((job) => job.github_commit_sha === commitSha) ?? null; }
  async latestPublishJob() { return this.publishJobs.at(-1) ?? null; }
  async updatePublishJob(commitSha: string, status: string, deploymentUrl: string | null) { const current = this.publishJobs.find((job) => job.github_commit_sha === commitSha); if (current) Object.assign(current, { status, deployment_url: deploymentUrl }); }
  async listAudit(input: { user?: string; action?: string; entity?: string; outcome?: string; from?: number; to?: number; limit: number }) {
    return this.auditEvents.filter((event) => !input.action || event.action.includes(input.action)).slice(-input.limit).reverse().map((event, index) => ({ id: `audit-${index}`, actor_user_id: event.actorUserId, actor_login: this.users.get(event.actorUserId ?? "")?.displayLogin ?? null, actor_role: this.users.get(event.actorUserId ?? "")?.role ?? null, action: event.action, target_type: event.targetType, target_id: event.targetId, request_id: event.requestId, outcome: event.outcome ?? "success", created_at: now + index }));
  }
}

class MemoryReader {
  documents: Partial<Record<ContentKey, unknown>> = {
    products: { products: [{ id: "product-1", name: "Платье", price: 1000, compare_at_price: 1200, status: "published", variants: [{ stock_quantity: 2 }] }] },
    categories: { categories: [] }, collections: { collections: [] }, homepage: { sections: [] }, settings: { settings: { store_name: "Зиярат" } }
  };
  failure: Error | null = null;
  async readByKey(key: ContentKey): Promise<GitHubDocument> {
    if (this.failure) throw this.failure;
    return { path: `content/${key}.json` as GitHubDocument["path"], sha: "read-only-sha", value: this.documents[key] };
  }
}

const hasher: PasswordHasher = { algorithm: "test", hash: async (value) => value, verify: async (password, encoded) => password === encoded };
const env = { DB: {} as D1Database, ENVIRONMENT: "production", ALLOWED_ORIGINS: "https://shop.example.com", GITHUB_OWNER: "owner", GITHUB_REPO: "repo", GITHUB_REF: "main", WRITES_ENABLED: "false", IP_HASH_PEPPER: "test-pepper" } satisfies Env;
const config = { environment: "production" as const, allowedOrigins: new Set(["https://shop.example.com"]), githubOwner: "owner", githubRepo: "repo", githubRef: "main", writesEnabled: false, ipHashPepper: "test-pepper" };

function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers); headers.set("Origin", "https://shop.example.com");
  return new Request(`https://admin-api.example.com${path}`, { ...options, headers });
}

function cookies(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  const session = raw.match(/za_admin_session=([^;]+)/u)?.[1] ?? "";
  const csrf = raw.match(/za_admin_csrf=([^;]+)/u)?.[1] ?? "";
  return `za_admin_session=${session}; za_admin_csrf=${csrf}`;
}

describe("Admin v1 Worker Phase 1", () => {
  let store: MemoryStore;
  let reader: MemoryReader;
  beforeEach(() => { store = new MemoryStore(admin()); reader = new MemoryReader(); });
  const app = () => createApp(env, { store, reader, hasher, config });
  const login = async (loginName = "admin", password = "correct-password") => {
    const response = await app().fetch(request("/api/admin/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://shop.example.com" }, body: JSON.stringify({ login: loginName, password }) }));
    return { response, cookie: cookies(response) };
  };

  it("creates an HttpOnly, Secure session after a successful login and records audit", async () => {
    const { response } = await login();
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(response.status).toBe(200); expect(setCookie).toContain("HttpOnly"); expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict"); expect(setCookie).toContain("Path=/api/admin"); expect(setCookie).not.toContain("Domain=");
    expect(store.auditEvents.at(-1)?.action).toBe("auth.login_success");
  });

  it("creates a real session through the login endpoint with a stored scrypt hash", async () => {
    const user = admin();
    user.passwordHash = await passwordHasher.hash("Ziyarat-2026!endpoint");
    user.passwordAlgorithm = passwordHasher.algorithm;
    store = new MemoryStore(user);
    const realApp = createApp(env, { store, reader, hasher: passwordHasher, config });
    const valid = await realApp.fetch(request("/api/admin/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: "Ziyarat-2026!endpoint" }) }));
    expect(valid.status).toBe(200);
    expect(store.sessions.size).toBe(1);
    expect(valid.headers.get("set-cookie")).toContain("HttpOnly");
    const invalid = await realApp.fetch(request("/api/admin/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: "Ziyarat-2026!wrong" }) }));
    expect(invalid.status).toBe(401);
  });

  it("does not distinguish a bad password, missing user, or disabled user", async () => {
    expect((await login("admin", "wrong-pass")).response.status).toBe(401);
    expect((await login("missing", "wrong-pass")).response.status).toBe(401);
    const disabled = store.users.get("admin-1"); if (!disabled) throw new Error("Missing test admin"); disabled.isActive = false;
    expect((await login()).response.status).toBe(401);
  });

  it("rejects unauthenticated, expired and revoked sessions", async () => {
    expect((await app().fetch(request("/api/admin/products"))).status).toBe(401);
    const { cookie } = await login(); const session = [...store.sessions.values()][0]; if (!session) throw new Error("Missing test session"); session.expiresAt = Date.now() - 1;
    const expired = await app().fetch(request("/api/admin/products", { headers: { Cookie: cookie, Origin: "https://shop.example.com" } }));
    expect(expired.status).toBe(401);
    const { cookie: activeCookie } = await login(); const revoked = store.users.get("admin-1"); if (!revoked) throw new Error("Missing test admin"); revoked.sessionVersion += 1;
    const revokedResponse = await app().fetch(request("/api/admin/products", { headers: { Cookie: activeCookie, Origin: "https://shop.example.com" } }));
    expect(revokedResponse.status).toBe(401);
  });

  it("enforces CSRF and does not allow a MODERATOR to read settings", async () => {
    const { cookie } = await login();
    const csrfFailure = await app().fetch(request("/api/admin/auth/logout", { method: "POST", headers: { Cookie: cookie, Origin: "https://shop.example.com" } }));
    expect(csrfFailure.status).toBe(403);
    store = new MemoryStore(moderator());
    const { cookie: moderatorCookie } = await login("moderator");
    const settingsResponse = await app().fetch(request("/api/admin/settings", { headers: { Cookie: moderatorCookie, Origin: "https://shop.example.com" } }));
    expect(settingsResponse.status).toBe(403);
  });

  it("returns real dashboard counters and keeps the audit feed ADMIN-only", async () => {
    const loggedIn = await login();
    await store.audit({ actorUserId: "admin-1", action: "products.updated", targetType: "product", targetId: "product-1", requestId: "request-audit" });
    const headers = { Cookie: loggedIn.cookie, Origin: "https://shop.example.com" };
    const dashboard = await app().fetch(request("/api/admin/dashboard", { headers }));
    expect(dashboard.status).toBe(200);
    expect(await dashboard.json()).toMatchObject({ total: 1, published: 1, hidden: 0, without_card_image: 1, without_stock: 0, categories: 0, collections: 0 });
    const audit = await app().fetch(request("/api/admin/audit?action=products", { headers }));
    expect(audit.status).toBe(200);
    expect(await audit.json()).toEqual([expect.objectContaining({ action: "products.updated", request_id: "request-audit" })]);
    store = new MemoryStore(moderator());
    const moderatorLogin = await login("moderator");
    expect((await app().fetch(request("/api/admin/audit", { headers: { Cookie: moderatorLogin.cookie } }))).status).toBe(403);
  });

  it("audits logout and password changes, then revokes the old session", async () => {
    const loggedIn = await login(); const loginBody = await loggedIn.response.clone().json() as { csrf_token: string };
    const logout = await app().fetch(request("/api/admin/auth/logout", { method: "POST", headers: { Cookie: loggedIn.cookie, Origin: "https://shop.example.com", "X-CSRF-Token": loginBody.csrf_token } }));
    expect(logout.status).toBe(200); expect(store.auditEvents.at(-1)?.action).toBe("auth.logout");
    expect([...store.sessions.values()][0]?.revokedAt).not.toBeNull();
    const cleared = logout.headers.get("set-cookie") ?? "";
    expect(cleared).toContain("za_admin_session=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0; Secure");
    expect(cleared).toContain("za_admin_csrf=; Path=/api/admin; SameSite=Strict; Max-Age=0; Secure");
    const loggedOutMe = await app().fetch(request("/api/admin/auth/me", { headers: { Cookie: loggedIn.cookie, Origin: "https://shop.example.com" } }));
    expect(loggedOutMe.status).toBe(401);
    expect((await loggedOutMe.json() as { authenticated: boolean }).authenticated).toBe(false);
    const secondLogin = await login(); const secondBody = await secondLogin.response.clone().json() as { csrf_token: string };
    const changed = await app().fetch(request("/api/admin/auth/password/change", { method: "POST", headers: { Cookie: secondLogin.cookie, Origin: "https://shop.example.com", "X-CSRF-Token": secondBody.csrf_token, "Content-Type": "application/json" }, body: JSON.stringify({ current_password: "correct-password", new_password: "new-password" }) }));
    expect(changed.status).toBe(200); expect(store.auditEvents.at(-1)?.action).toBe("auth.password_changed");
    const oldSession = await app().fetch(request("/api/admin/products", { headers: { Cookie: secondLogin.cookie, Origin: "https://shop.example.com" } }));
    expect(oldSession.status).toBe(401);
  });

  it("rate limits repeated login failures", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) expect((await login("admin", "wrong-pass")).response.status).toBe(401);
    expect((await login("admin", "wrong-pass")).response.status).toBe(429);
  });

  it("handles malformed content and GitHub failures without leaking secrets", async () => {
    const { cookie } = await login(); const headers = { Cookie: cookie, Origin: "https://shop.example.com" };
    reader.documents.products = { unexpected: true };
    expect((await app().fetch(request("/api/admin/products", { headers }))).status).toBe(502);
    reader.failure = new AppError(503, "github_unavailable", "GitHub временно недоступен");
    const unavailable = await app().fetch(request("/api/admin/products", { headers }));
    expect(unavailable.status).toBe(503); expect(await unavailable.text()).not.toContain("never-expose-me");
    reader.failure = new AppError(502, "github_auth_error", "GitHub Reader не авторизован");
    expect((await app().fetch(request("/api/admin/products", { headers }))).status).toBe(502);
  });

  it("rejects invalid Origins and disallowed CORS preflight", async () => {
    const invalid = await app().fetch(new Request("https://admin-api.example.com/api/admin/auth/login", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ login: "admin", password: "correct-password" }) }));
    expect(invalid.status).toBe(403); expect(invalid.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const preflight = await app().fetch(new Request("https://admin-api.example.com/api/admin/products", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } }));
    expect(preflight.status).toBe(403);
    const allowed = await app().fetch(new Request("https://admin-api.example.com/api/admin/auth/login", { method: "OPTIONS", headers: { Origin: "https://shop.example.com", "Access-Control-Request-Method": "POST" } }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://shop.example.com");
    expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("has content writes disabled by default", async () => {
    const { cookie } = await login();
    const csrf = String((await login()).response.headers.get("set-cookie") ?? "");
    const response = await app().fetch(request("/api/admin/products", { method: "POST", headers: { Cookie: cookie, Origin: "https://shop.example.com", "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" }));
    expect(response.status).toBe(503); expect((await response.json() as { error: { code: string } }).error.code).toBe("WRITE_DISABLED");
  });
});
