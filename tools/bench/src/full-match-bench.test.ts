import { describe, expect, it } from 'vitest';

import { estimateSnapshotBytes, parseOptions } from './full-match-bench.ts';

describe('бенчмарк полного матча', () => {
  it('ограничивает игроков допустимыми сценариями и принимает минуты', () => {
    expect(parseOptions(['--players=30,100', '--minutes=5'])).toEqual({
      players: [30, 100],
      minutes: 5,
    });
    expect(() => parseOptions(['--players=20'])).toThrow('только 30 и 100');
    expect(() => parseOptions(['--minutes=0'])).toThrow('положительным целым');
  });

  it('оценивает размер снимка без сериализации всего сообщения', () => {
    const view = {
      tick: 1,
      hexes: {
        owner: new Int16Array(2),
        pop: new Int32Array(2),
        improvement: new Uint8Array(2),
        building: new Uint8Array(2),
        road: new Uint8Array(2),
        link: new Uint8Array(2),
        growth: new Int32Array(2),
        visible: new Uint8Array(2),
      },
      units: [],
      plans: [],
    } as never;
    expect(estimateSnapshotBytes(view)).toBe(576);
  });
});
