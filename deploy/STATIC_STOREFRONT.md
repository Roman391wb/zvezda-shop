# Static storefront deployment — Cloudflare Pages

The current free public deployment is only the generated storefront. It does
not deploy `/admin`, FastAPI, PostgreSQL, checkout persistence or server-side
inventory. Full-stack source remains in this repository for a later upgrade.

## Export data after catalogue changes

On a machine that has the full-stack Docker services and the current database:

```bash
docker compose up -d
docker compose exec -T api python -m app.static_export /tmp/storefront.json
docker compose cp api:/tmp/storefront.json apps/web/data/storefront.json
docker compose cp api:/app/media/. apps/web/public/media
```

The existing seed catalogue image files are already in `apps/web/public/images`.
Commit `apps/web/data/storefront.json` and any copied `apps/web/public/media`
assets before deploying.

## Cloudflare Pages

1. Push the repository to GitHub.
2. In Cloudflare Pages, select **Create a project** and connect that repository.
3. Set **Root directory** to `apps/web`.
4. Set **Build command** to `npm ci && npm run build:static`.
5. Set **Build output directory** to `out`.
6. Add environment variable `NEXT_PUBLIC_WHATSAPP_NUMBER` with the store's
   WhatsApp number in international digits-only format.
7. Deploy. Cloudflare provides a free `*.pages.dev` URL.

No `DATABASE_URL`, `ADMIN_SESSION_SECRET`, API URL or PostgreSQL credentials
belong in Cloudflare Pages variables for this static deployment.

## Local static QA

```bash
cd apps/web
cp ../../.env.static.example .env.local
npm ci
npm run build:static
npx serve out
```

Stop FastAPI/PostgreSQL before the final smoke test. The output contains static
HTML, JS, product data and public media only; `/admin` is pruned after build.
