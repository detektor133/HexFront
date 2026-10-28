import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  ...(process.env.VISUAL_OUT_DIR ? { outputDir: process.env.VISUAL_OUT_DIR } : {}),
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...(process.env.VISUAL_OUT_DIR ? { screenshot: 'on' as const } : {}),
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    url: 'http://127.0.0.1:5173/dev/map',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['iPhone 13'] } },
  ],
});
