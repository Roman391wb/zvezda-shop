#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

read -r -s -p "Введите новый пароль администратора: " admin_password
printf '\n'
if [[ -z "$admin_password" ]]; then
  printf 'Пароль не может быть пустым. Настройки не изменены.\n' >&2
  exit 1
fi

password_hash="$(printf '%s' "$admin_password" | docker compose exec -T api python -c 'import sys, bcrypt; print(bcrypt.hashpw(sys.stdin.buffer.read(), bcrypt.gensalt()).decode())')"
session_secret="$(docker compose exec -T api python -c 'import secrets; print(secrets.token_urlsafe(48))')"

temp_env="$(mktemp .env.admin.XXXXXX)"
chmod 600 "$temp_env"
awk -v password_hash="$password_hash" -v session_secret="$session_secret" '
  BEGIN { saw_password_hash = 0; saw_session_secret = 0 }
  /^ADMIN_PASSWORD_HASH=/ { print "ADMIN_PASSWORD_HASH='\''" password_hash "'\''"; saw_password_hash = 1; next }
  /^ADMIN_SESSION_SECRET=/ { print "ADMIN_SESSION_SECRET=" session_secret; saw_session_secret = 1; next }
  { print }
  END {
    if (!saw_password_hash) print "ADMIN_PASSWORD_HASH='\''" password_hash "'\''"
    if (!saw_session_secret) print "ADMIN_SESSION_SECRET=" session_secret
  }
' .env > "$temp_env"
mv "$temp_env" .env
chmod 600 .env

docker compose up -d --force-recreate api >/dev/null

for _ in {1..20}; do
  if docker compose exec -T api python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=2)' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

printf '%s' "$admin_password" | docker compose exec -T api python -c '
import json
import sys
import urllib.request

password = sys.stdin.read()
request = urllib.request.Request(
    "http://127.0.0.1:8000/api/admin/auth/login",
    data=json.dumps({"password": password}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=15) as response:
    if response.status != 200:
        raise SystemExit("Admin login verification failed")
' 
unset admin_password password_hash session_secret
printf 'Пароль администратора настроен и проверен.\n'
