-- SQLite cannot alter a CHECK constraint in place. Preserve Phase 1 rows while
-- adopting the explicit lifecycle used by the content-write pilot.
CREATE TABLE publish_jobs_phase2 (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('awaiting_run', 'queued', 'in_progress', 'success', 'failure', 'cancelled')),
  operation TEXT NOT NULL,
  github_commit_sha TEXT,
  deployment_url TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  paths_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (actor_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

INSERT INTO publish_jobs_phase2 (
  id, actor_user_id, status, operation, github_commit_sha, deployment_url,
  error_code, error_message, metadata_json, paths_json, created_at, updated_at,
  started_at, finished_at
)
SELECT
  id,
  actor_user_id,
  CASE status
    WHEN 'QUEUED' THEN 'queued'
    WHEN 'RUNNING' THEN 'in_progress'
    WHEN 'SUCCEEDED' THEN 'success'
    WHEN 'FAILED' THEN 'failure'
    WHEN 'CANCELLED' THEN 'cancelled'
    ELSE 'awaiting_run'
  END,
  operation,
  github_commit_sha,
  deployment_url,
  error_code,
  error_message,
  metadata_json,
  paths_json,
  created_at,
  updated_at,
  started_at,
  finished_at
FROM publish_jobs;

DROP TABLE publish_jobs;
ALTER TABLE publish_jobs_phase2 RENAME TO publish_jobs;

CREATE INDEX idx_publish_jobs_status_created ON publish_jobs(status, created_at DESC);
CREATE INDEX idx_publish_jobs_commit ON publish_jobs(github_commit_sha);
