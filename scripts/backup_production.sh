#!/usr/bin/env bash
set -euo pipefail

# Creates a portable PostgreSQL dump and media archive. It never modifies the
# running database or media volume. Run on the production host via cron/systemd.
env_file="${1:-.env.production}"
backup_root="${BACKUP_ROOT:-.backups}"
[[ -f "$env_file" ]] || { printf 'Missing %s\n' "$env_file" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_root/$stamp"
mkdir -p "$target"
chmod 700 "$backup_root" "$target"

docker compose --env-file "$env_file" -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$target/postgres.dump"
docker compose --env-file "$env_file" -f docker-compose.prod.yml exec -T api \
  tar -C /app/media -czf - . > "$target/media.tar.gz"
sha256sum "$target/postgres.dump" "$target/media.tar.gz" > "$target/SHA256SUMS"
chmod 600 "$target"/*

# Retention is local only. Copy completed archives off-host before they expire.
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime +"${BACKUP_RETENTION_DAYS:-30}" -exec rm -rf {} +
printf 'Backup created: %s\n' "$target"
