# 07/T19 — условия публикации Pages через env

## Ревью 2026-10-14

- `.github/workflows/pages.yml`: секреты Cloudflare объявлены в `env` job-уровня.
- Условия публикации и пропуска используют `env.CLOUDFLARE_API_TOKEN` и `env.CLOUDFLARE_ACCOUNT_ID`.
- `apps/client/test/deployment-env.test.ts` проверяет job-level `env`, оба условия и отсутствие `secrets.` в `if:`.
- `rg` по изменённым workflow и тестам подтвердил отсутствие `secrets.` в `if:`; секреты остаются только в `env` и параметрах действия.
- `pnpm verify --changed`: `verify: OK`.

Этап: 07/T19
