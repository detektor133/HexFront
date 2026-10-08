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
      players: 30,
      ticks: 0,
      revision: 'test-revision',
    });

    expect(results.map(({ metrics: _metrics, ...result }) => result)).toEqual([
      {
        runIndex: 0,
        seed: 41,
        ticks: 0,
        revision: 'test-revision',
        map: { id: 'proc-29', players: 30, width: 80, height: 60 },
      },
      {
        runIndex: 1,
        seed: 42,
        ticks: 0,
        revision: 'test-revision',
        map: { id: 'proc-2a', players: 30, width: 80, height: 60 },
      },
      {
        runIndex: 2,
        seed: 43,
        ticks: 0,
        revision: 'test-revision',
        map: { id: 'proc-2b', players: 30, width: 80, height: 60 },
      },
    ]);
    for (const result of results) {
      expect(result.metrics).toMatchObject({
        durationTicks: 0,
        neutralHexShareAt3Min: null,
        firstBattleMinute: null,
        cauldrons: 0,
        placesByStartPosition: expect.any(Array),
        timeline: [],
      });
    }
  });

  it('отклоняет стенд с числом игроков, отличным от 30', async () => {
    await expect(
      runBalanceMatches({
        matches: 1,
        seeds: [41],
        parallelism: 1,
        players: 2,
        ticks: 0,
        revision: 'test',
      }),
    ).rejects.toThrow('30 игроков');
  });

  it('получает одинаковые параметры карты для одинакового сида', async () => {
    const options = {
      matches: 1,
      seeds: [41],
      parallelism: 1,
      players: 30,
      ticks: 0,
      revision: 'test-revision',
    } as const;
    const first = await runBalanceMatches(options);
    const second = await runBalanceMatches(options);

    expect(first[0]?.map).toEqual(second[0]?.map);
  });
});
