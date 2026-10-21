import { describe, expect, it } from 'vitest';

import { classifyFiles, decideMode } from './docs-only.ts';

const push = (files: readonly string[] | undefined, before = 'abc') =>
  decideMode({ event: 'push', before, sha: 'def', diff: () => files });

describe('режим CI для docs-пуша', () => {
  it('считает служебными отметки этапа, STATUS, отчёты и списки вопросов', () => {
    expect(
      classifyFiles([
        'docs/stages/stage-06-bots-balance.md',
        'docs/STATUS.md',
        'docs/reports/stage-06.md',
        'docs/BUGS.md',
        'docs/QUESTIONS.md',
        'docs/DECISIONS.md',
      ]),
    ).toBe('docs');
  });

  it.each([
    ['docs/gdd/10-balance.md', 'зеркало balance.ts читает balance-doc.test.ts'],
    ['docs/art/tokens.json', 'источник сгенерированных токенов'],
    ['docs/gdd/09-bots.md', 'GDD меняется только через $decide'],
    ['packages/sim/src/step.ts', 'код'],
    ['.github/workflows/ci.yml', 'сам CI'],
    ['docs/STATUS.md.bak', 'похожее имя'],
  ])('гоняет полный CI, если есть %s (%s)', (file) => {
    expect(classifyFiles(['docs/STATUS.md', file])).toBe('full');
  });

  it('гоняет полный CI для пустого списка файлов', () => {
    expect(classifyFiles([])).toBe('full');
  });

  it('берёт режим docs только для push с известным предыдущим коммитом', () => {
    expect(push(['docs/STATUS.md'])).toBe('docs');
    expect(push(['docs/STATUS.md'], '0000000000000000000000000000000000000000')).toBe('full');
    expect(push(['docs/STATUS.md'], '')).toBe('full');
    expect(push(undefined)).toBe('full');
    expect(
      decideMode({
        event: 'pull_request',
        before: 'abc',
        sha: 'def',
        diff: () => ['docs/STATUS.md'],
      }),
    ).toBe('full');
  });

  it('смотрит весь диапазон пуша, а не только последний коммит', () => {
    expect(push(['tools/evolve/src/evaluate.ts', 'docs/stages/stage-06-bots-balance.md'])).toBe(
      'full',
    );
  });
});
