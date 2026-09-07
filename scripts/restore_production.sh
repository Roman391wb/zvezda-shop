#!/usr/bin/env bash
set -euo pipefail

# Intentionally guarded: restoring replaces production database/media state.
env_file="${1:-.env.production}"
backup_dir="${2:-}"
[[ "${RESTORE_CONFIRM:-}" == "YES" ]] || { printf 'Set RESTORE_CONFIRM=YES after reviewing the backup target.\n' >&2; exit 1; }
[[ -f "$env_file" && -f "$backup_dir/postgres.dump" && -f "$backup_dir/media.tar.gz" ]] || { printf 'Provide .env.production and a valid backup directory.\n' >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
sha256sum -c "$backup_dir/SHA256SUMS"
docker compose --env-file "$env_file" -f docker-compose.prod.yml stop web proxy
docker compose --env-file "$env_file" -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$backup_dir/postgres.dump"
docker compose --env-file "$env_file" -f docker-compose.prod.yml exec -T api \
  sh -c 'find /app/media -mindepth 1 -delete && tar -C /app/media -xzf -' < "$backup_dir/media.tar.gz"
docker compose --env-file "$env_file" -f docker-compose.prod.yml up -d web proxy
printf 'Restore complete. Run the production smoke checks before reopening traffic.\n'
