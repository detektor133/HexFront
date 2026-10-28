import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { batchReviewFindings, testTimedOut } from './finding-repair.ts';

describe('диагностика таймаута verify', () => {
  it('читает причину из лога, когда краткая сводка её скрывает', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hexfront-timeout-test-'));
    try {
      await mkdir(join(root, '.ai-logs'));
      await writeFile(
        join(root, '.ai-logs', 'verify-2026-10-28T09-53-15.log'),
        'FAIL test/t17q.test.ts\nError: Test timed out in 5000ms.\n',
      );
      expect(
        await testTimedOut(
          root,
          'verify: FAIL tests\nлог: .ai-logs/verify-2026-10-28T09-53-15.log',
          '',
        ),
      ).toBe(true);
      expect(await testTimedOut(root, 'verify: FAIL lint', '')).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('пакет возвратов review', () => {
  it('передаёт замечания к коду и тестам одному исполнителю в исходном порядке', () => {
    expect(
      batchReviewFindings([
        { kind: 'КОД', text: 'КОД: сломан HUD' },
        { kind: 'ТЕСТ', text: 'ТЕСТ: нет проверки края' },
        { kind: 'КОД', text: 'КОД: неверный формат' },
      ]),
    ).toEqual([
      {
        kind: 'КОД',
        text: '1. КОД: сломан HUD\n2. ТЕСТ: нет проверки края\n3. КОД: неверный формат',
      },
    ]);
  });

  it('передаёт тестовый дефект тому же исполнителю, что и продуктовый', () => {
    expect(
      batchReviewFindings([
        { kind: 'ТЕСТ', text: 'ТЕСТ: неверное ожидание' },
        { kind: 'КОД', text: 'КОД: неверный результат' },
        { kind: 'ТЕСТ', text: 'ТЕСТ: отсутствует край' },
      ]),
    ).toEqual([
      {
        kind: 'КОД',
        text: '1. ТЕСТ: неверное ожидание\n2. КОД: неверный результат\n3. ТЕСТ: отсутствует край',
      },
    ]);
  });

  it('не оставляет повторно добавленный пункт отдельной работой', () => {
    expect(
      batchReviewFindings([
        { kind: 'КОД', text: 'КОД: причина уже исправлена' },
        { kind: 'ТЕСТ', text: 'ТЕСТ: старое ожидание' },
        { kind: 'КОД', text: 'КОД: причина уже исправлена' },
        { kind: 'КОД', text: 'КОД: второй дефект продукта' },
      ]),
    ).toEqual([
      {
        kind: 'КОД',
        text: '1. КОД: причина уже исправлена\n2. ТЕСТ: старое ожидание\n3. КОД: второй дефект продукта',
      },
    ]);
  });

  it('решение plan остаётся перед рабочим пакетом', () => {
    expect(
      batchReviewFindings([
        { kind: 'ТЕСТ', text: 'ТЕСТ: фикстура' },
        { kind: 'ПЛАН', text: 'ПЛАН: уточнить критерий' },
        { kind: 'КОД', text: 'КОД: кнопка' },
      ]),
    ).toEqual([
      { kind: 'ПЛАН', text: 'ПЛАН: уточнить критерий' },
      { kind: 'КОД', text: '1. ТЕСТ: фикстура\n2. КОД: кнопка' },
    ]);
  });
});
