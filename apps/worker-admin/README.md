# Admin v1 Worker — Phase 0–2

This package is an isolated Admin v1 Worker. Phase 2 adds a content-write pilot, but writes remain disabled by default (`WRITES_ENABLED=false`). It does not replace Sveltia and does not route production `/admin`.

## Configuration

For Phase 2.5, create only the staging D1 database `zvezda-admin-staging`, replace its placeholder ID in `[env.staging]`, then apply the migration. Production has no D1 binding yet and remains write-disabled until the Phase 4 cutover preparation. Set these secrets in the Cloudflare dashboard or with Wrangler; never place them in `wrangler.toml`, `.env` committed to Git, browser code, or logs:

- `IP_HASH_PEPPER` — random secret used to pseudonymize IP and user-agent values.
- `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` — GitHub App credentials used only server-side when writes are explicitly enabled. The installation must have **Contents: Read/Write** and **Actions: Read**; do not grant Workflow write.

`ALLOWED_ORIGINS` is an exact comma-separated allowlist. A production Pages site and Worker API must use same-site custom subdomains (for example `shop.example.com` and `admin-api.example.com`) so the host-only session cookie is usable with credentialed CORS requests.

## First ADMIN

There is no registration route. After applying the migration, run `ADMIN_LOGIN=admin npm run bootstrap:admin` interactively. The helper emits a one-time SQL `INSERT` containing a versioned `scrypt-v1` password hash, never the plaintext password. Pipe or paste that statement directly into a controlled `wrangler d1 execute` session, then discard it. The Worker retains fail-closed parsing for legacy `pbkdf2-sha256-v1` records, but new staging credentials use scrypt.

## Commands

```bash
npm install
npm run typecheck
npm run lint
npm test
```

When `WRITES_ENABLED=true`, the only writable paths are `content/products.json`, `content/categories.json`, `content/collections.json`, `content/homepage.json`, `content/settings.json`, and UUID-named JPEG/PNG/WebP files below `apps/web/public/uploads/`. There is no generic Git-path endpoint.
