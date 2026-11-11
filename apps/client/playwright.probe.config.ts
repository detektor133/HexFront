// Конфиг зондов производительности на боевой сборке (vite preview), не тестов приёмки.
// Запуск: pnpm --filter @hexfront/client build, затем
//   pnpm --filter @hexfront/client exec playwright test -c playwright.probe.config.ts
import { defineConfig } from '@playwright/test';

const port = '4174';

export default defineConfig({
  testDir: './tests/probe',
  testMatch: '**/*.probe.ts',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
