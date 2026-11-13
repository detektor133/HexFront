import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import {
  createMatch,
  distance,
  hexFromId,
  hexId,
  loadMap,
  planStarts,
  START_GAP,
  TERRAIN,
} from '../src/index.ts';

function load() {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  return loaded.map;
}

describe('свободные стартовые точки', () => {
  it('желаемый гекс людей сдвигается к суше, боты получают случайные места по зерну', () => {
    const map = load();
    const wanted = [hexId({ q: 10, r: 10 }, map.width), null, null];
    const first = planStarts(map, 7, wanted);
    expect(planStarts(map, 7, wanted)).toEqual(first);
    expect(planStarts(map, 8, wanted)).not.toEqual(first);
    for (const start of first) {
      const terrain = map.terrain[hexId(start, map.width)];
      expect(terrain).not.toBe(TERRAIN.water);
      expect(terrain).not.toBe(TERRAIN.mountains);
    }
  });

  it('столицы не стоят вплотную; второй игрок с тем же желанием получает соседнее место', () => {
    const map = load();
    const same = hexId({ q: 12, r: 8 }, map.width);
    const [a, b] = planStarts(map, 1, [same, same]);
    expect(a && b && distance(a, b)).toBeGreaterThanOrEqual(START_GAP);
  });

  it('матч с freeStarts ставит столицу игрока там, где показывал план', () => {
    const map = load();
    const want = hexId({ q: 14, r: 9 }, map.width);
    const plan = planStarts(map, 5, [want, null, null]);
    const state = createMatch(map, [{ name: 'A', start: want }, { name: 'B' }, { name: 'C' }], 5, {
      freeStarts: true,
    });
    plan.forEach((hex, player) => {
      const capital = state.cities.find((c) => c.id === state.players[player]?.capitalCityId);
      expect(capital && hexFromId(capital.hex, map.width)).toEqual(hex);
    });
  });
});
