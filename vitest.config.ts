import { defineConfig } from 'vitest/config';

import { testProjects } from './vitest.projects.ts';

// Быстрый уровень: всё, кроме SLOW_TESTS. Vitest читает конфиг только через default-экспорт.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: testProjects(false),
  },
});
