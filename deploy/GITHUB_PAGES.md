# Бесплатная публикация: GitHub Pages + Git-based CMS

Публичный магазин — статический Next.js output. Он не использует FastAPI,
PostgreSQL, server checkout или платный хостинг. GitHub Pages неизбежно делает
код, изображения и `content/` публичными; не храните там персональные данные,
пароли или секреты.

## Где редактируется контент

- `content/products.json` — товары, варианты, остатки, изображения, публикация,
  новинки, хиты, скидки и порядок.
- `content/categories.json` и `content/collections.json` — таксономия, фото,
  видимость и порядок.
- `content/homepage.json` — Hero (desktop/mobile фото, текст, CTA, alignment),
  Новинки, Хиты, Распродажа и видимость секций.
- `content/settings.json` — магазин, WhatsApp, контакты, доставка, возврат,
  footer и SEO.
- `apps/web/public/uploads/` — изображения, добавленные через CMS.

Для разового обновления данных из сохранённой full-stack версии запустите
`docker compose exec -T api python -m app.static_export /tmp/storefront.json`,
скопируйте JSON в `apps/web/data/storefront.json`, затем выполните
`cd apps/web && npm run content:split`.

## Первое подключение GitHub

1. Создайте **пустой публичный** GitHub repository.
2. На компьютере добавьте remote и отправьте подготовленные ветки и tag:

   ```bash
   git remote add origin https://github.com/OWNER/REPOSITORY.git
   git push -u origin main fullstack-v1 --tags
   ```

3. В repository **Settings → Pages → Build and deployment** выберите
   **GitHub Actions**.
4. В **Settings → Actions → General** разрешите workflows read/write permissions.
5. Первый push в `main` запускает `.github/workflows/deploy-pages.yml`. URL будет
   `https://OWNER.github.io/REPOSITORY/` (для репозитория `OWNER.github.io` — без
   второго сегмента). Workflow сам учитывает этот base path.

## Подключение `/admin`

`/admin/` — Sveltia CMS. Это статическая панель, которая после входа делает
коммиты и pull requests в GitHub. Для безопасного OAuth необходим бесплатный
Cloudflare Worker, а не токен в браузере.

1. Разверните официальный
   [Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth) в
   Cloudflare Workers.
2. Создайте GitHub OAuth App с callback `https://YOUR-WORKER.workers.dev/callback`.
3. Сохраните `GITHUB_CLIENT_ID` и `GITHUB_CLIENT_SECRET` **только** как encrypted
   Worker secrets. Укажите `ALLOWED_DOMAINS=OWNER.github.io`.
4. В GitHub repository откройте **Settings → Secrets and variables → Actions →
   Variables** и добавьте `CMS_AUTH_BASE_URL` со значением URL Worker. Это не
   секрет, он попадает в CMS config.
5. Сделайте пустой commit/push в `main`, чтобы workflow собрал `admin/config.yml`
   с фактическими repository и Worker URL.

Клиентский код не содержит GitHub PAT, OAuth secret или пароль. `config.yml`
публикует только название repo и URL OAuth Worker.

## ADMIN / MODERATOR — реальные права GitHub

Sveltia CMS не является системой RBAC: защита только скрытием полей была бы
небезопасна. Здесь право на публикацию проверяет GitHub:

1. ADMIN получает GitHub repository **Admin/Maintain**; MODERATOR — только
   **Write**.
2. Скопируйте `.github/CODEOWNERS.example` в `.github/CODEOWNERS` и замените
   `@YOUR_GITHUB_USERNAME` на ADMIN или GitHub Team ADMIN.
3. В **Settings → Branches** защитите `main`: Require a pull request before
   merging, Require review from Code Owners, запретите force-push и разрешите
   обход правила только ADMIN.
4. `publish_mode: editorial_workflow` в CMS создаёт PR. MODERATOR может менять
   товары, медиа, категории, коллекции и главную, но не может самостоятельно
   опубликовать `settings`, workflow, CMS-конфигурацию или security-изменения.
   ADMIN проверяет и merge-ит PR; только merge запускает Pages deploy.

GitHub не даёт ограничить Write-collaborator по отдельным JSON-файлам при прямом
commit. Поэтому обязательные PR + protected branch + Code Owners — безопасный
минимум без платного сервера. До включения этих правил не выдавайте MODERATOR
доступ.

## Обычный цикл обновления

1. ADMIN/MODERATOR открывает `https://OWNER.github.io/REPOSITORY/admin/` и входит
   через собственный GitHub account.
2. CMS создаёт commit/PR: товары и изображения хранятся в GitHub.
3. ADMIN merge-ит PR в `main`.
4. GitHub Actions выполняет `npm ci && npm run build:static` и публикует новый
   static output на Pages.

Корзина и избранное находятся только в `localStorage`. Кнопка WhatsApp собирает
название, размер, цвет, количество, цену и итоговую сумму на устройстве
покупателя; имя, телефон, email, адрес и заказ не записываются на сайт.

## Локальная проверка

```bash
cd apps/web
npm ci
GITHUB_PAGES=true GITHUB_REPOSITORY=OWNER/REPOSITORY \
CMS_AUTH_BASE_URL=https://YOUR-WORKER.workers.dev npm run build:static
```

Проверьте `out/admin/index.html`, `out/catalog/index.html` и
`out/product/<slug>/index.html`. Не публикуйте `apps/web/out` в git: Action
создаёт его заново.
