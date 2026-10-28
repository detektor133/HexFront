import { defineConfig } from 'vitest/config';

import { testProjects } from './vitest.projects.ts';

// Быстрый уровень: всё, кроме SLOW_TESTS. Vitest читает конфиг только через default-экспорт.
export default defineConfig({
  test: {
    passWithNoTests: true,
    // При полной матрице десятки jsdom/fork workers конкурируют за CPU и отдельные DOM-тесты
    // превышают 5 с только в общем прогоне. Восемь workers сохраняют сами проверки и их таймаут.
    maxWorkers: 8,
    projects: testProjects(false),
  },
});
