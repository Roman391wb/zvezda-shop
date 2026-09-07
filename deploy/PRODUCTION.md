# Production launch runbook

This project uses one HTTPS origin: `https://DOMAIN`. Caddy is the only public
container (`80` redirects to HTTPS; `443` serves the application). PostgreSQL,
FastAPI and Next.js are attached only to the internal Docker network.

## Before the first launch

1. Provision a Linux server with Docker Compose, a firewall allowing only TCP
   80/443 and SSH from the operator's address, and enough persistent disk for
   database, media and backups.
2. Copy `.env.production.example` to `.env.production`; replace every
   placeholder with unique production values and run `chmod 600 .env.production`.
   Generate the session secret with `openssl rand -base64 48`. Do not place a
   plaintext admin password in the file.
3. Create DNS `A` records for `DOMAIN` and `www.DOMAIN` pointing to the server's
   public IPv4 address. If IPv6 is used, add equivalent `AAAA` records.
4. Ensure ports 80/443 are reachable before starting Caddy so ACME can issue
   certificates. The canonical host is non-www.
5. Copy the existing persistent PostgreSQL and media volumes, or restore a
   verified backup, before the first production start.

## Safe deploy order

```bash
./scripts/backup_production.sh .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS https://DOMAIN/health
```

API startup runs Alembic upgrades. Review migrations before deployment; do not
deploy a migration that drops or rewrites existing data. Keep the previous image
digest and the last backup until production smoke tests pass.

## Backups and restore

Run `backup_production.sh` at least daily with a systemd timer or cron; retention
defaults to 30 days. Copy completed encrypted-at-rest archives to separate
storage. Test restore on an isolated host. `restore_production.sh` requires
`RESTORE_CONFIRM=YES` because it replaces the database and media contents.
Example systemd units are in `deploy/systemd/`; install them under `/etc/systemd/system`,
review the `WorkingDirectory`, then enable with `systemctl enable --now ziyarat-backup.timer`.
Keep an encrypted, access-controlled copy of `.env.production` outside the server;
the backup script intentionally does not package secrets.

## Rollback

Stop at the proxy, restore the previous image digest/Compose revision, then run
health checks. If a migration or data change must be rolled back, restore the
matching database and media backup together. Never delete Docker volumes as a
rollback method.
