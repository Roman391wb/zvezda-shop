PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY NOT NULL,
  login_normalized TEXT NOT NULL UNIQUE,
  display_login TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_algorithm TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MODERATOR')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  password_changed_at INTEGER NOT NULL,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_users_active_role ON admin_users(is_active, role);

CREATE TRIGGER IF NOT EXISTS prevent_last_active_admin_change
BEFORE UPDATE OF is_active, role ON admin_users
WHEN OLD.role = 'ADMIN' AND OLD.is_active = 1
  AND (NEW.role <> 'ADMIN' OR NEW.is_active <> 1)
  AND (SELECT COUNT(*) FROM admin_users WHERE role = 'ADMIN' AND is_active = 1) = 1
BEGIN
  SELECT RAISE(ABORT, 'cannot remove the last active ADMIN');
END;

CREATE TRIGGER IF NOT EXISTS prevent_last_active_admin_delete
BEFORE DELETE ON admin_users
WHEN OLD.role = 'ADMIN' AND OLD.is_active = 1
  AND (SELECT COUNT(*) FROM admin_users WHERE role = 'ADMIN' AND is_active = 1) = 1
BEGIN
  SELECT RAISE(ABORT, 'cannot delete the last active ADMIN');
END;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip_hash TEXT,
  user_agent_hash TEXT,
  FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_active ON admin_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  key_hash TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lock ON login_attempts(locked_until);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT,
  target_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  request_id TEXT NOT NULL,
  ip_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created ON audit_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_target_created ON audit_events(target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  response_status INTEGER,
  response_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES admin_users(id) ON DELETE RESTRICT,
  UNIQUE(actor_user_id, operation, request_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('awaiting_run', 'queued', 'in_progress', 'success', 'failure', 'cancelled')),
  operation TEXT NOT NULL,
  github_commit_sha TEXT,
  deployment_url TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (actor_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_status_created ON publish_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS system_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by_user_id TEXT,
  FOREIGN KEY (updated_by_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
);
