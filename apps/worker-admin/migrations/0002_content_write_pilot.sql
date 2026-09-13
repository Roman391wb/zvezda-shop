ALTER TABLE audit_events ADD COLUMN outcome TEXT NOT NULL DEFAULT 'success';
ALTER TABLE audit_events ADD COLUMN commit_sha TEXT;

ALTER TABLE publish_jobs ADD COLUMN paths_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE publish_jobs ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_publish_jobs_commit ON publish_jobs(github_commit_sha);
CREATE INDEX IF NOT EXISTS idx_idempotency_actor_operation ON idempotency_keys(actor_user_id, operation, expires_at);
