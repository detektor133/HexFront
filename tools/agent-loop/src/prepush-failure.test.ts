import { describe, expect, it } from 'vitest';

import { failedChecks, failureKey, prePushFinding } from './prepush-failure.ts';
import { runWorld } from './test-world.ts';

const PLAYWRIGHT_OUTPUT = [
  '  1) [desktop] › tests\\e2e\\t17ccb-metric-rows-layout.spec.ts:8:3 › @layout строки не переполняются',
  '    Error: expect(received).toBeGreaterThanOrEqual(expected)',
  '    Expected: >= 162.375',
  '    Received:    29',
  '  6 failed',
].join('\n');

describe('разбор красной приёмки перед push', () => {
  it('называет упавшую Playwright-спеку и тест Vitest', () => {
    const checks = failedChecks(
      `${PLAYWRIGHT_OUTPUT}\n❯ |client| test/unit-groups.test.ts (3 tests | 1 failed)`,
    );

    expect(checks.e2e).toEqual(['apps/client/tests/e2e/t17ccb-metric-rows-layout.spec.ts']);
    expect(checks.unit).toEqual(['test/unit-groups.test.ts']);
    expect(failureKey(checks)).toContain('t17ccb-metric-rows-layout.spec.ts');
  });

  it('для чужой проверки велит искать нарушенное допущение и даёт команду воспроизведения', () => {
    const checks = failedChecks(PLAYWRIGHT_OUTPUT);
    const found = prePushFinding(
      'Expected: >= 162.375',
      checks,
      ['apps/client/src/dev/HexCard.tsx'],
      0,
    );

    expect(found.text).toContain(
      'pnpm test:e2e:layout apps/client/tests/e2e/t17ccb-metric-rows-layout.spec.ts',
    );
    expect(found.text).toContain('задача не меняла');
    expect(found.text).not.toContain('-й подряд провал');
  });

  it('для проверки, которую задача сама меняла, не говорит о чужом допущении', () => {
    const checks = failedChecks(PLAYWRIGHT_OUTPUT);
    const found = prePushFinding(
      'Expected: >= 162.375',
      checks,
      ['apps/client/tests/e2e/t17ccb-metric-rows-layout.spec.ts'],
      0,
    );

    expect(found.text).not.toContain('задача не меняла');
  });

  it('при повторе требует воспроизвести и не отвечать «уже сделано»', () => {
    const found = prePushFinding('x', failedChecks(PLAYWRIGHT_OUTPUT), [], 1);

    expect(found.text).toContain('2-й подряд провал');
    expect(found.text).toContain('Не отвечай «уже сделано»');
  });

  it('третий подряд провал тех же проверок останавливает цикл вместо нового круга', async () => {
    const key = failureKey(failedChecks(PLAYWRIGHT_OUTPUT));
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'pre-push',
          findings: [],
          prePushFailure: { key, count: 2 },
        },
      },
      sessions: [],
      prePush: [`pre-push: FAIL\n${PLAYWRIGHT_OUTPUT}`, `pre-push: FAIL\n${PLAYWRIGHT_OUTPUT}`],
    });

    expect(run.prompts).toEqual([]);
    expect(run.lines.join('\n')).toContain('3-й раз подряд');
  });
});
