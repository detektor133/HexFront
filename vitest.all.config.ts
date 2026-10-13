import { defineConfig } from 'vitest/config';

import { testProjects } from './vitest.projects.ts';

// Все тесты с покрытием: workflow `slow` и `pnpm test:all`.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: testProjects(true),
    coverage: {
      provider: 'v8',
      include: ['packages/sim/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/sim/src/index.ts'],
      // testing.md: покрытие packages/sim ≥ 90 % строк; считается по всем тестам, с тяжёлыми.
      thresholds: { lines: 90 },
    },
  },
});
