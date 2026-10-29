import { defineConfig } from 'vitest/config';

import { testProjects } from './vitest.projects.ts';

// Быстрый уровень: всё, кроме SLOW_TESTS. Vitest читает конфиг только через default-экспорт.
export default defineConfig({
  test: {
    passWithNoTests: true,
    // На CI восемь одновременных jsdom/fork workers дважды превысили 5 с в независимых DOM-тестах.
    // Четыре workers уменьшают конкуренцию за CPU без изменения утверждений тестов.
    maxWorkers: 4,
    projects: testProjects(false),
  },
});
