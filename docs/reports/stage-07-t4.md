# Отчёт 07/T4 — сборка по ссылке

- Workflow: `.github/workflows/pages.yml`.
- Основной адрес Cloudflare Pages: `https://hexfront.pages.dev` для ветки `main`.
- Адрес предпросмотра этапа: `https://stage-07.hexfront.pages.dev` для ветки `stage-07`.
- Публикуемый каталог: `apps/client/dist`.
- ADR: `docs/architecture/adr/0012-cloudflare-pages-deployment.md`.
- `pnpm verify --changed`: зелёный; сборка содержит `index.html`, `404.html` отсутствует.
- Без `CLOUDFLARE_API_TOKEN` или `CLOUDFLARE_ACCOUNT_ID` публикация пропускается с сообщением, workflow не падает.
