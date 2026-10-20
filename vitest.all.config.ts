import { defineConfig } from 'vitest/config';

import { testProjects } from './vitest.projects.ts';

// Все тесты: workflow `slow` и первая часть `pnpm test:all`.
export default defineConfig({
  test: {
    passWithNoTests: true,
    // Полный прогон содержит несколько CPU-тяжёлых интеграционных тестов. На двухъядерном CI
    // конкуренция workers превращает их функциональные пределы времени в случайные падения.
    maxWorkers: 1,
    projects: testProjects(true),
  },
});
