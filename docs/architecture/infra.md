# Инфраструктура

## Окружения

| Окружение | Где | Что |
| --- | --- | --- |
| local | машина разработчика | `pnpm dev`: клиент (Vite) + сервер; локальный режим без сервера |
| staging | Hetzner CX23 (Хельсинки) | автодеплой из `main` |
| prod-eu | Hetzner CX33 → CX43 по нагрузке | ручной релиз по тегу |
| prod-ru | российский VPS (Timeweb Cloud / Яндекс Облако) | тот же образ; для RU-сборки из-за мобильных белых списков |

Статика клиента — на порталах (CrazyGames, Яндекс Игры хостят сами) и на своём домене за Cloudflare.

## Docker

`apps/server/Dockerfile` — multi-stage:

```dockerfile
# draft — финальная версия в этапе 06
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile && pnpm --filter server... build \
 && pnpm --filter server deploy --prod /out

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=build /out .
USER nonroot
EXPOSE 8080
CMD ["dist/main.js"]
```

- Non-root, distroless, только prod-зависимости, `HEALTHCHECK` через отдельный `/healthz` эндпоинт в приложении (curl в distroless нет — проверку делает оркестратор/compose по HTTP).
- `docker-compose.yml` для staging/prod: сервер + Caddy (TLS, reverse proxy для wss) — Caddy с автоматическими сертификатами.
- Секреты — через переменные окружения из файла вне репозитория; в репо только `.env.example`.

## CI (GitHub Actions)

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck` · `pnpm lint` · `pnpm depcheck` (dependency-cruiser)
3. `pnpm test` (Vitest, включая property- и golden-тесты)
4. `pnpm test:visual` (Playwright, скриншоты) — начиная с этапа 04
5. `pnpm bench:sim` — провал, если `step` p99 > 10 мс на эталонном сценарии
6. Сборка Docker-образа (этап 06+), пуш в GHCR по тегу

## Наблюдаемость

- Логи сервера — JSON в stdout (pino разрешён в ADR этапа 06).
- Метрики комнаты: игроков, длительность тика p50/p99, трафик на игрока, отклонённые команды.
- Ошибки клиента — собственный лёгкий эндпоинт `/client-errors` (без сторонних SDK до этапа 07).
