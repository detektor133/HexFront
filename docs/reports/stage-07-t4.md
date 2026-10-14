# Отчёт 07/T4 — сборка по ссылке

- Workflow: `.github/workflows/pages.yml`.
- Основной адрес Cloudflare Pages: `https://hexfront.pages.dev` для ветки `main`.
- Адрес предпросмотра этапа: `https://stage-07.hexfront.pages.dev` для ветки `stage-07`.
- Публикуемый каталог: `apps/client/dist`.
- ADR: `docs/architecture/adr/0012-cloudflare-pages-deployment.md`.
- `pnpm verify --changed`: зелёный; сборка содержит `index.html`, `404.html` отсутствует, прямые запросы `/` и `/match` возвращают SPA `index.html` через статический обработчик собранного `dist`.
- Без `CLOUDFLARE_API_TOKEN` или `CLOUDFLARE_ACCOUNT_ID` публикация пропускается с сообщением, workflow не падает.
- Приёмочный тест `apps/client/test/deployment.test.ts` запускает реальную сборку клиента, проверяет проект `hexfront`, ветку `${{ github.ref_name }}`, обе ветки workflow, SPA-маршруты и точные условия публикации/пропуска по секретам.
