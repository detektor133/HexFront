import { describe, expect, it } from 'vitest';

import { parseOptions, runBalanceMatches } from './index.ts';

describe('запуск балансировочных матчей', () => {
  it('отклоняет нулевое число матчей и параллельность вне диапазона', () => {
    expect(() => parseOptions(['--matches=0'])).toThrow('число матчей');
    expect(() => parseOptions(['--parallelism=0'])).toThrow('параллельность');
    expect(() => parseOptions(['--parallelism=3', '--matches=2'])).not.toThrow();
  });

  it('возвращает результаты в порядке индекса запуска и сохраняет сид', async () => {
    const results = await runBalanceMatches({
      matches: 3,
      seeds: [41, 42, 43],
      parallelism: 2,
      players: 2,
      ticks: 0,
    });

    expect(results).toEqual([
      { runIndex: 0, seed: 41, ticks: 0 },
      { runIndex: 1, seed: 42, ticks: 0 },
      { runIndex: 2, seed: 43, ticks: 0 },
    ]);
  });
});
