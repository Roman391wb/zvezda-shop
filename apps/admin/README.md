# Separate Admin UI

`apps/admin` is a static, separately deployed Admin UI. It never reads or writes
repository files and never receives GitHub credentials. Every state-changing
operation is sent to `apps/worker-admin` with the authenticated Admin API
session, CSRF token, revision and idempotency key.

For deployment copy `public/config.template.js` to `public/config.js`, set only
the public API origin, then run `npm run build` and deploy `dist/` to a separate
Admin origin. Configure that origin in the Worker `ALLOWED_ORIGINS` variable.
