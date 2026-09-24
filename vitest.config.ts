import { defineConfig } from 'vitest/config';

const PROJECTS = [
  'packages/sim',
  'packages/protocol',
  'packages/mapgen',
  'apps/server',
  'apps/client',
  'tools/balance',
  'tools/replay',
  'tools/commit-check',
  'tools/tokens',
];

// Vitest читает конфиг только через default-экспорт.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: PROJECTS.map((root) => ({
      test: {
        name: root.split('/')[1] ?? root,
        root,
        include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
        exclude: ['test/fixtures/**', 'node_modules/**'],
      },
    })),
    coverage: {
      provider: 'v8',
      include: ['packages/sim/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/sim/src/index.ts'],
      // testing.md: покрытие packages/sim ≥ 90 % строк.
      thresholds: { lines: 90 },
    },
  },
});
