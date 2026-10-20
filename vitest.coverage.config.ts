import { defineConfig } from 'vitest/config';

import { testProjects } from './vitest.projects.ts';

const simProject = testProjects(true).find((project) => project.test.root === 'packages/sim');
if (!simProject) throw new Error('Проект packages/sim не найден');

// Покрытие считается отдельно: V8 coverage меняет тайминги интеграционных тестов с git-процессами.
export default defineConfig({
  test: {
    passWithNoTests: true,
    maxWorkers: 1,
    projects: [simProject],
    coverage: {
      provider: 'v8',
      include: ['packages/sim/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/sim/src/index.ts'],
      // testing.md: покрытие packages/sim ≥ 90 % строк; считается со всеми тестами sim.
      thresholds: { lines: 90 },
    },
  },
});
