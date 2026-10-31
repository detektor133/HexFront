import { defineConfig, devices } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT ?? '5173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  ...(process.env.VISUAL_OUT_DIR ? { outputDir: process.env.VISUAL_OUT_DIR } : {}),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...(process.env.VISUAL_OUT_DIR ? { screenshot: 'on' as const } : {}),
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/dev/map`,
    reuseExistingServer: process.env.PLAYWRIGHT_PORT === undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['iPhone 13'] } },
  ],
});
