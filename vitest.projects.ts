// Проекты Vitest и два уровня тестов (docs/testing.md, «Уровни тестов»).
import { fileURLToPath } from 'node:url';

export const PROJECTS = [
  'packages/sim',
  'packages/protocol',
  'packages/mapgen',
  'apps/server',
  'apps/client',
  'tools/balance',
  'tools/replay',
  'tools/ai-check',
  'tools/commit-check',
  'tools/ci-wait',
  'tools/tokens',
  'tools/telemetry',
  'tools/agent-loop',
  'tools/evolve',
] as const;

/**
 * Тяжёлые файлы (дольше 4 с на CI): только в `pnpm test:all` — workflow `slow` на каждый push.
 * Быстрый `pnpm test` и `verify --changed` их не запускают: коммит и CI задачи их не ждут,
 * а таймауты на медленном ПК не блокируют работу. Пути — от корня репозитория.
 */
export const SLOW_TESTS = [
  'packages/sim/test/invariants/random-match.test.ts',
  'packages/sim/test/supply-network-index.test.ts',
  'packages/sim/test/golden/development.test.ts',
  'packages/sim/test/golden/war.test.ts',
  'packages/sim/test/unit-path-index.test.ts',
  'packages/sim/test/bot-determinism.test.ts',
  'packages/sim/test/view-bulk.test.ts',
  'packages/sim/test/scenarios/front-ring.test.ts',
  'packages/sim/test/scenarios/offensive-direction.test.ts',
  'packages/mapgen/test/validate-generated.test.ts',
  'packages/mapgen/test/map.test.ts',
  'apps/client/test/offensive-scenes.test.ts',
  'apps/client/test/view-delta-memory.test.ts',
  'tools/evolve/src/index.test.ts',
  'tools/replay/src/acceptance.test.ts',
] as const;

const SLOW_TEST_TIMEOUT_MS = 120_000;
// Аудит кэшей производных данных (state/derived.ts) включён во всех тестах, что гоняют симуляцию.
const DERIVED_AUDIT_SETUP = fileURLToPath(
  new URL('./packages/sim/test/derived-audit.setup.ts', import.meta.url),
);
const AUDITED_ROOTS: readonly string[] = ['packages/sim', 'tools/replay', 'tools/bench'];
const CLIENT_BUILD_SETUP = fileURLToPath(
  new URL('./apps/client/test/build.global-setup.ts', import.meta.url),
);

/** @returns проекты Vitest; `withSlow` — вместе с тяжёлыми файлами (`pnpm test:all`). */
export function testProjects(withSlow: boolean) {
  return PROJECTS.flatMap((root) => {
    // Тесты самого агентного цикла (40 файлов) не гоняются на каждый коммит: ночной `slow` и
    // `pnpm test:all` их запускают. Менял цикл — запусти `pnpm test:all:projects --project agent-loop`.
    if (!withSlow && root === 'tools/agent-loop') return [];
    const slow = SLOW_TESTS.filter((file) => file.startsWith(`${root}/`)).map((file) =>
      file.slice(root.length + 1),
    );
    const project = {
      test: {
        name: root.split('/')[1] ?? root,
        root,
        include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
        exclude: [
          'test/fixtures/**',
          'node_modules/**',
          ...(root === 'apps/client' ? ['test/**/*.dom.test.tsx'] : []),
          ...(withSlow ? [] : slow),
        ],
        // Полный уровень: 5 с по умолчанию проверяли бы скорость раннера, а не код (replay
        // acceptance шёл 4,5 с и падал по таймауту). Здесь таймаут — только защита от зависания,
        // скорость меряет tools/bench. Проекты не наследуют корневой testTimeout.
        ...(withSlow ? { testTimeout: SLOW_TEST_TIMEOUT_MS } : {}),
        ...(AUDITED_ROOTS.includes(root) ? { setupFiles: [DERIVED_AUDIT_SETUP] } : {}),
        // Тесты сборки читают dist: клиент собирается один раз до них, а не в каждом файле.
        ...(root === 'apps/client' ? { globalSetup: [CLIENT_BUILD_SETUP] } : {}),
      },
    };
    if (root !== 'apps/client') return [project];
    return [
      project,
      {
        test: {
          name: 'client-dom',
          root,
          include: ['test/**/*.dom.test.tsx'],
          exclude: ['node_modules/**'],
          environment: 'jsdom',
          viteEnvironment: 'ssr',
          pool: 'forks',
          setupFiles: ['test/dom.setup.ts'],
          ...(withSlow ? { testTimeout: SLOW_TEST_TIMEOUT_MS } : {}),
          plugins: [
            {
              name: 'client-dom-test-url',
              transform(source: string, id: string) {
                if (!id.endsWith('match-surface.dom.test.tsx')) return;
                return source.replace(
                  'new URL(`../../../${path}`, import.meta.url)',
                  "new URL('../../../' + path, import.meta.url)",
                );
              },
            },
          ],
        },
      },
    ];
  });
}
