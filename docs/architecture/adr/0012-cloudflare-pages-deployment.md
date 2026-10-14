# ADR 0012: Публикация клиента в Cloudflare Pages

## Решение

Workflow `.github/workflows/pages.yml` запускается после push в `main` и `stage-*`. Он устанавливает зависимости, собирает клиент командой `pnpm --filter @hexfront/client build` и публикует `apps/client/dist` через `cloudflare/wrangler-action` в проект Pages `hexfront`.

Основная ветка публикуется как `main`, а ветки этапов — как preview-ветки через `--branch=${{ github.ref_name }}`. Если отсутствует хотя бы один из секретов `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`, шаг публикации пропускается с сообщением и workflow остаётся зелёным.

Клиент использует SPA-режим Vite (`appType: 'spa'`), поэтому сборка содержит `index.html` и не создаёт `404.html`. Cloudflare Pages отдаёт `index.html` для прямых переходов по маршрутам `/` и `/match`.

## Причины

Публикация через workflow даёт одинаковый процесс для основной ветки и предпросмотров. Условие на секреты позволяет проверять сборку до настройки аккаунта Cloudflare; без него workflow падал бы на каждом push и блокировал проверку кода.

## Последствия

- Для реальной публикации владелец должен создать проект `hexfront` и добавить оба секрета GitHub Actions.
- Preview-адрес Cloudflare Pages определяется именем ветки и доменом проекта: `https://<ветка>.hexfront.pages.dev`.
