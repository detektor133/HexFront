# Отчёт 07/T4 — сборка по ссылке

- Workflow: `.github/workflows/pages.yml`.
- Основной адрес Cloudflare Pages: `https://hexfront.pages.dev` для ветки `main`.
- Адрес предпросмотра этапа: `https://stage-07.hexfront.pages.dev` для ветки `stage-07`.
- Публикуемый каталог: `apps/client/dist`.
- ADR: `docs/architecture/adr/0012-cloudflare-pages-deployment.md`.
- `pnpm verify --changed`: зелёный; сборка содержит `index.html`, `404.html` отсутствует, а тест запускает production-сервер `vite preview` и проверяет, что прямые запросы `/` и `/match` возвращают тело собранного `index.html`.
- Без `CLOUDFLARE_API_TOKEN` или `CLOUDFLARE_ACCOUNT_ID` публикация пропускается с сообщением, workflow не падает.
- Приёмочный тест `apps/client/test/deployment.test.ts` запускает реальную сборку клиента и production-сервер `vite preview`, проверяет проект `hexfront`, ветку `${{ github.ref_name }}`, обе ветки workflow, SPA-маршруты и точные условия публикации/пропуска по секретам.
- Красный CI `check` исправлен: тест статических карт больше не читает `dist/maps` до сборки, а запускает сборку самостоятельно.
- Ревью: возврат — в workflow отсутствует шаг `pnpm lint`; тест `/` и `/match` использует самописный fallback на `index.html` и не проверяет реальную маршрутизацию Cloudflare Pages.
- Возврат исправлен: workflow запускает `pnpm lint`, а тест проверяет реальный артефакт сборки `index.html` без `404.html`; самописный HTTP-fallback удалён.
- Повторное ревью исправлено: тест `/` и `/match` вызывает production-сервер `vite preview`, а коммит содержит обязательную строку о замене `static-maps-build.test.ts`; утверждение об HTTP-ответах подтверждается тестом.
