# Зиярат

Интернет-магазин «Зиярат». Проект включает витрину на Next.js, доменный API на FastAPI и PostgreSQL.

## Launch

```bash
cp .env.example .env
docker compose up --build
```

- Storefront: http://localhost:3000
- API docs: http://localhost:8000/docs
- API health: http://localhost:8000/health

For local development, see `apps/web` and `apps/api` package scripts.
