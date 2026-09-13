# Admin v1 operations

Admin v1 is a static Cloudflare Pages UI backed by a Cloudflare Worker. D1 stores administrators, sessions, idempotency records, audit events, and publish jobs. Catalog and storefront content remain JSON and media files in GitHub.

## Environments

| Environment | Admin | API | D1 | Git branch | Default writes |
| --- | --- | --- | --- | --- | --- |
| Staging | `https://ziyarat-admin-staging.pages.dev` | `https://zvezda-admin-api-staging.romankurbanov391.workers.dev/api/admin` | `ziyarat-admin-staging` | `admin-staging` | disabled |
| Production | `https://ziyarat-admin.pages.dev` | `https://zvezda-admin-api-production.romankurbanov391.workers.dev/api/admin` | `ziyarat-admin-production` | `main` | disabled until rollout gates pass |

The Worker enforces the environment/branch pair independently: staging can write only `admin-staging`, and production can write only `main`. CORS uses the exact Admin origin and never `*`.

## Disable writes

Set `WRITES_ENABLED = "false"` in the relevant Wrangler environment and redeploy that Worker. Confirm a mutation returns `503 WRITE_DISABLED`. Disabling writes does not end existing sessions.

## Revoke sessions

Use a controlled Wrangler D1 command against the explicitly named environment database. Set `revoked_at` for one user's active sessions, or all active sessions during an incident. Verify the database name before execution. Never copy session tokens into a command or log.

## Content rollback

The pre-rollout production checkpoint is tag `pre-admin-v1-production`, resolving to commit `4864ea00256bbe4b1dcf9ee8ac3ba2a0b5fb4da7`. It captures `content/*.json` and all referenced media.

1. Disable production writes.
2. Compare current content with the checkpoint.
3. Restore only the affected content/media paths from the checkpoint into a new working tree.
4. Validate JSON, run storefront typecheck and `build:static`, review the diff, and create a normal compensating commit.
5. Push normally to `main`; never force-push or move `main` backward.
6. Confirm the Worker reads the restored revision and inspect the audit/publish result.

For a single Admin mutation, prefer its saved before-value and a revision-aware compensating Admin API update.

## Rotate GitHub App credentials

Keep the App ID, installation ID, and private key only in Cloudflare Worker secrets. Generate/revoke keys in GitHub, update the production Worker secrets through protected `wrangler secret put --env production` prompts, redeploy, and verify a repository read before enabling writes. Do not reuse frontend config or commit values.

## Reset an ADMIN password

Run the repository bootstrap helper locally with an interactive password prompt. It generates a `scrypt-v1` hash. Apply only the generated SQL to the intended D1 database through a controlled terminal, then discard it. Revoke the user's existing sessions. There is no public bootstrap endpoint.

## Recover from a revision conflict

A `409 CONTENT_CONFLICT` means Git changed after the editor loaded. Do not retry with the old revision. Reload the entity, review the current value, reapply the intended change, preview, and submit with the new ETag and a new idempotency key.
