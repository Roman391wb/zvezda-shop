import type { AdminSession, AdminUser } from "./types";

type D1Row = Record<string, unknown>;

function asNumber(value: unknown): number { return typeof value === "number" ? value : Number(value); }
function asNullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : asNumber(value); }

function mapUser(row: D1Row): AdminUser {
  return {
    id: String(row.id), loginNormalized: String(row.login_normalized), displayLogin: String(row.display_login),
    passwordHash: String(row.password_hash), passwordAlgorithm: String(row.password_algorithm),
    role: row.role === "ADMIN" ? "ADMIN" : "MODERATOR", isActive: Boolean(row.is_active),
    sessionVersion: asNumber(row.session_version), passwordChangedAt: asNumber(row.password_changed_at),
    lastLoginAt: asNullableNumber(row.last_login_at), createdAt: asNumber(row.created_at), updatedAt: asNumber(row.updated_at)
  };
}

function mapSession(row: D1Row): AdminSession {
  return {
    id: String(row.id), userId: String(row.user_id), secretHash: String(row.secret_hash), csrfHash: String(row.csrf_hash),
    sessionVersion: asNumber(row.session_version), createdAt: asNumber(row.created_at), lastSeenAt: asNumber(row.last_seen_at),
    expiresAt: asNumber(row.expires_at), revokedAt: asNullableNumber(row.revoked_at),
    ipHash: row.ip_hash === null ? null : String(row.ip_hash), userAgentHash: row.user_agent_hash === null ? null : String(row.user_agent_hash)
  };
}

export interface AuditInput {
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  requestId: string;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
  outcome?: "success" | "failure" | "blocked";
  commitSha?: string | null;
}

export type IdempotencyState =
  | { kind: "new" }
  | { kind: "completed"; status: number; response: unknown }
  | { kind: "failed"; status: number; response: unknown }
  | { kind: "conflict" }
  | { kind: "pending" };

export interface SessionInput {
  id: string;
  userId: string;
  secretHash: string;
  csrfHash: string;
  sessionVersion: number;
  createdAt: number;
  expiresAt: number;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface AdminStore {
  findUserByLogin(login: string): Promise<AdminUser | null>;
  findUserById(id: string): Promise<AdminUser | null>;
  markUserLoggedIn(id: string, now: number): Promise<void>;
  createSession(input: SessionInput): Promise<void>;
  findSession(id: string): Promise<AdminSession | null>;
  touchSession(id: string, now: number): Promise<void>;
  revokeSession(id: string, now: number): Promise<void>;
  revokeUserSessions(userId: string, now: number): Promise<void>;
  changePassword(userId: string, hash: string, algorithm: string, now: number): Promise<void>;
  recordAttempt(keyHash: string, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  clearAttempts(keyHash: string): Promise<void>;
  audit(input: AuditInput): Promise<void>;
  beginIdempotency(input: { actorUserId: string; operation: string; keyHash: string; requestHash: string; now: number }): Promise<IdempotencyState>;
  completeIdempotency(input: { actorUserId: string; operation: string; keyHash: string; status: number; response: unknown }): Promise<void>;
  failIdempotency(input: { actorUserId: string; operation: string; keyHash: string; status: number; response: unknown }): Promise<void>;
  createPublishJob(input: { actorUserId: string; commitSha: string; paths: string[]; now: number }): Promise<void>;
  inventoryHistory(productId: string): Promise<Record<string, unknown>[]>;
  publishJob(commitSha: string): Promise<Record<string, unknown> | null>;
  latestPublishJob(): Promise<Record<string, unknown> | null>;
  updatePublishJob(commitSha: string, status: string, deploymentUrl: string | null, now: number): Promise<void>;
  listUsers?(): Promise<AdminUser[]>;
  createUser?(input: AdminUser): Promise<void>;
  updateUser?(id: string, input: { role?: "ADMIN" | "MODERATOR"; isActive?: boolean; now: number }): Promise<AdminUser | null>;
}

export class D1AdminStore implements AdminStore {
  constructor(private readonly db: D1Database) {}

  async findUserByLogin(login: string): Promise<AdminUser | null> {
    const row = await this.db.prepare("SELECT * FROM admin_users WHERE login_normalized = ? LIMIT 1").bind(login).first<D1Row>();
    return row ? mapUser(row) : null;
  }

  async findUserById(id: string): Promise<AdminUser | null> {
    const row = await this.db.prepare("SELECT * FROM admin_users WHERE id = ? LIMIT 1").bind(id).first<D1Row>();
    return row ? mapUser(row) : null;
  }

  async listUsers(): Promise<AdminUser[]> {
    const result = await this.db.prepare("SELECT * FROM admin_users ORDER BY created_at DESC").all<D1Row>();
    return result.results.map(mapUser);
  }

  async createUser(input: AdminUser): Promise<void> {
    await this.db.prepare("INSERT INTO admin_users (id,login_normalized,display_login,password_hash,password_algorithm,role,is_active,session_version,password_changed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(input.id, input.loginNormalized, input.displayLogin, input.passwordHash, input.passwordAlgorithm, input.role, input.isActive ? 1 : 0, input.sessionVersion, input.passwordChangedAt, input.createdAt, input.updatedAt).run();
  }

  async updateUser(id: string, input: { role?: "ADMIN" | "MODERATOR"; isActive?: boolean; now: number }): Promise<AdminUser | null> {
    const current = await this.findUserById(id); if (!current) return null;
    await this.db.prepare("UPDATE admin_users SET role=?, is_active=?, session_version=session_version + ?, updated_at=? WHERE id=?")
      .bind(input.role ?? current.role, input.isActive === undefined ? (current.isActive ? 1 : 0) : (input.isActive ? 1 : 0), input.role !== undefined || input.isActive !== undefined ? 1 : 0, input.now, id).run();
    if (input.role !== undefined || input.isActive === false) await this.revokeUserSessions(id, input.now);
    return this.findUserById(id);
  }

  async markUserLoggedIn(id: string, now: number): Promise<void> {
    await this.db.prepare("UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?").bind(now, now, id).run();
  }

  async createSession(input: SessionInput): Promise<void> {
    await this.db.prepare(
      "INSERT INTO admin_sessions (id,user_id,secret_hash,csrf_hash,session_version,created_at,last_seen_at,expires_at,ip_hash,user_agent_hash) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(input.id, input.userId, input.secretHash, input.csrfHash, input.sessionVersion, input.createdAt, input.createdAt, input.expiresAt, input.ipHash, input.userAgentHash).run();
  }

  async findSession(id: string): Promise<AdminSession | null> {
    const row = await this.db.prepare("SELECT * FROM admin_sessions WHERE id = ? LIMIT 1").bind(id).first<D1Row>();
    return row ? mapSession(row) : null;
  }

  async touchSession(id: string, now: number): Promise<void> {
    await this.db.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, id).run();
  }

  async revokeSession(id: string, now: number): Promise<void> {
    await this.db.prepare("UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").bind(now, id).run();
  }

  async revokeUserSessions(userId: string, now: number): Promise<void> {
    await this.db.prepare("UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?").bind(now, userId).run();
  }

  async changePassword(userId: string, hash: string, algorithm: string, now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE admin_users SET password_hash = ?, password_algorithm = ?, password_changed_at = ?, session_version = session_version + 1, updated_at = ? WHERE id = ?").bind(hash, algorithm, now, now, userId),
      this.db.prepare("UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?").bind(now, userId)
    ]);
  }

  async recordAttempt(keyHash: string, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const windowMs = 15 * 60_000;
    const maxAttempts = 8;
    await this.db.prepare(
      `INSERT INTO login_attempts (key_hash,window_started_at,attempts,locked_until,updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(key_hash) DO UPDATE SET
         window_started_at = CASE WHEN login_attempts.locked_until > ? OR login_attempts.window_started_at + ? > ? THEN login_attempts.window_started_at ELSE excluded.window_started_at END,
         attempts = CASE WHEN login_attempts.locked_until > ? THEN login_attempts.attempts WHEN login_attempts.window_started_at + ? <= ? THEN 1 ELSE login_attempts.attempts + 1 END,
         locked_until = CASE WHEN login_attempts.locked_until > ? THEN login_attempts.locked_until WHEN (CASE WHEN login_attempts.window_started_at + ? <= ? THEN 1 ELSE login_attempts.attempts + 1 END) > ? THEN ? ELSE NULL END,
         updated_at = excluded.updated_at`
    ).bind(keyHash, now, 1, null, now, now, windowMs, now, now, windowMs, now, now, windowMs, now, maxAttempts, now + windowMs).run();
    const row = await this.db.prepare("SELECT locked_until FROM login_attempts WHERE key_hash = ? LIMIT 1").bind(keyHash).first<{ locked_until: number | null }>();
    if (row?.locked_until && row.locked_until > now) return { allowed: false, retryAfterSeconds: Math.ceil((row.locked_until - now) / 1000) };
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async clearAttempts(keyHash: string): Promise<void> {
    await this.db.prepare("DELETE FROM login_attempts WHERE key_hash = ?").bind(keyHash).run();
  }

  async audit(input: AuditInput): Promise<void> {
    await this.db.prepare(
      "INSERT INTO audit_events (id,actor_user_id,target_user_id,action,target_type,target_id,request_id,ip_hash,metadata_json,outcome,commit_sha,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(crypto.randomUUID(), input.actorUserId ?? null, input.targetUserId ?? null, input.action, input.targetType ?? null, input.targetId ?? null, input.requestId, input.ipHash ?? null, JSON.stringify(input.metadata ?? {}), input.outcome ?? "success", input.commitSha ?? null, Date.now()).run();
  }

  async beginIdempotency(input: { actorUserId: string; operation: string; keyHash: string; requestHash: string; now: number }): Promise<IdempotencyState> {
    const current = await this.db.prepare("SELECT request_hash,status,response_status,response_json FROM idempotency_keys WHERE actor_user_id=? AND operation=? AND request_key_hash=? AND expires_at>? LIMIT 1").bind(input.actorUserId, input.operation, input.keyHash, input.now).first<{ request_hash: string; status: string; response_status: number | null; response_json: string | null }>();
    if (current) {
      if (current.request_hash !== input.requestHash) return { kind: "conflict" };
      if (current.status === "COMPLETED") return { kind: "completed", status: current.response_status ?? 500, response: current.response_json ? JSON.parse(current.response_json) : {} };
      if (current.status === "FAILED") return { kind: "failed", status: current.response_status ?? 500, response: current.response_json ? JSON.parse(current.response_json) : {} };
      return { kind: "pending" };
    }
    await this.db.prepare("INSERT INTO idempotency_keys (id,actor_user_id,operation,request_key_hash,request_hash,status,created_at,expires_at) VALUES (?,?,?,?,?,'PENDING',?,?)").bind(crypto.randomUUID(), input.actorUserId, input.operation, input.keyHash, input.requestHash, input.now, input.now + 86_400_000).run();
    return { kind: "new" };
  }

  async completeIdempotency(input: { actorUserId: string; operation: string; keyHash: string; status: number; response: unknown }): Promise<void> {
    await this.finishIdempotency(input, "COMPLETED");
  }

  async failIdempotency(input: { actorUserId: string; operation: string; keyHash: string; status: number; response: unknown }): Promise<void> {
    await this.finishIdempotency(input, "FAILED");
  }

  async createPublishJob(input: { actorUserId: string; commitSha: string; paths: string[]; now: number }): Promise<void> {
    await this.db.prepare("INSERT INTO publish_jobs (id,actor_user_id,status,operation,github_commit_sha,paths_json,metadata_json,created_at,updated_at) VALUES (?,?,'awaiting_run','content.write',?,?, '{}',?,?)").bind(crypto.randomUUID(), input.actorUserId, input.commitSha, JSON.stringify(input.paths), input.now, input.now).run();
  }

  async inventoryHistory(productId: string): Promise<Record<string, unknown>[]> {
    const result = await this.db.prepare("SELECT id,action,target_id,metadata_json,created_at,commit_sha FROM audit_events WHERE action='inventory.adjusted' AND json_extract(metadata_json, '$.product_id')=? ORDER BY created_at DESC LIMIT 200").bind(productId).all<Record<string, unknown>>();
    return result.results.map((row) => ({ ...row, metadata: row.metadata_json ? JSON.parse(String(row.metadata_json)) : {} }));
  }

  async publishJob(commitSha: string): Promise<Record<string, unknown> | null> {
    return await this.db.prepare("SELECT github_commit_sha,status,paths_json,deployment_url,error_code,error_message,created_at,updated_at FROM publish_jobs WHERE github_commit_sha=? ORDER BY created_at DESC LIMIT 1").bind(commitSha).first<Record<string, unknown>>();
  }

  async latestPublishJob(): Promise<Record<string, unknown> | null> {
    return await this.db.prepare("SELECT github_commit_sha,status,paths_json,deployment_url,error_code,error_message,created_at,updated_at FROM publish_jobs ORDER BY created_at DESC LIMIT 1").first<Record<string, unknown>>();
  }

  async updatePublishJob(commitSha: string, status: string, deploymentUrl: string | null, now: number): Promise<void> {
    await this.db.prepare("UPDATE publish_jobs SET status=?,deployment_url=?,updated_at=? WHERE github_commit_sha=?").bind(status, deploymentUrl, now, commitSha).run();
  }

  private async finishIdempotency(input: { actorUserId: string; operation: string; keyHash: string; status: number; response: unknown }, state: "COMPLETED" | "FAILED"): Promise<void> {
    await this.db.prepare("UPDATE idempotency_keys SET status=?,response_status=?,response_json=? WHERE actor_user_id=? AND operation=? AND request_key_hash=?").bind(state, input.status, JSON.stringify(input.response), input.actorUserId, input.operation, input.keyHash).run();
  }
}
