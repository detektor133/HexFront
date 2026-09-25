import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import tiny from '../../mapgen/maps/tiny.json' with { type: 'json' };
import { START_GOLD, START_POP_CAPITAL, START_POP_HEX, TAX_DEFAULT } from '../src/balance.ts';
import { loadMap } from '../src/map/load.ts';
import type { MapStatic } from '../src/map/types.ts';
import { distance, hexFromId, hexId } from '../src/math/hex.ts';
import { createMatch, pickStartNeighbors } from '../src/state/create-match.ts';
import { hashState } from '../src/state/hash.ts';
import { hexPopCap } from '../src/state/pop-cap.ts';
import { NEUTRAL } from '../src/state/types.ts';
import { SYSTEMS, step } from '../src/step.ts';

function mapOf(json: unknown): MapStatic {
  const result = loadMap(json);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.map;
}

const players = (n: number): { name: string }[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}` }));

const SEED = 42;

describe('стартовое состояние', () => {
  const map = mapOf(small);
  const state = createMatch(map, players(6), SEED);

  it('совпадает с golden-хэшем на карте small', () => {
    // Эталон стартовых правил; меняется только вместе с решением в DECISIONS.md.
    expect(hashState(state)).toBe('45bcf297');
  });

  it('каждый игрок получает столицу уровня 1 на своём спавне и 2 соседних гекса', () => {
    const spawnHexes = map.spawns.map((sp) => hexId(sp, map.width));
    const capitals = state.players.map(
      (p) => state.cities.find((c) => c.id === p.capitalCityId)?.hex,
    );
    expect([...capitals].sort((a = 0, b = 0) => a - b)).toEqual(
      [...spawnHexes].sort((a, b) => a - b),
    );
    for (const p of state.players) {
      const capital = state.cities.find((c) => c.id === p.capitalCityId);
      expect(capital).toMatchObject({ owner: p.id, level: 1 });
      const owned = [...state.hexes.owner.entries()].filter(([, o]) => o === p.id);
      expect(owned).toHaveLength(3);
      for (const [id] of owned) {
        const d = distance(hexFromId(id, map.width), hexFromId(capital?.hex ?? 0, map.width));
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it('население: столица 200, стартовые гексы по 40, нейтральные — 20 % лимита', () => {
    for (const p of state.players) {
      const capital = state.cities.find((c) => c.id === p.capitalCityId);
      const hexes = [...state.hexes.owner.entries()].filter(([, o]) => o === p.id);
      for (const [id] of hexes) {
        const expected = id === capital?.hex ? START_POP_CAPITAL : START_POP_HEX;
        expect(state.hexes.pop[id]).toBe(expected);
      }
    }
    const neutral = [...state.hexes.owner.entries()].find(
      ([id, o]) =>
        o === NEUTRAL && hexPopCap(state, id) > 0 && !state.cities.some((c) => c.hex === id),
    );
    expect(neutral).toBeDefined();
    const [id = 0] = neutral ?? [];
    expect(state.hexes.pop[id]).toBe((hexPopCap(state, id) * 200) / 1000);
  });

  it('игрок начинает с 200 золота, налогом 20 % и двумя армиями пехоты по 100 с приказом expand', () => {
    for (const p of state.players) {
      expect(p).toMatchObject({ gold: START_GOLD, taxTarget: TAX_DEFAULT, status: 'alive' });
      const armies = state.armies.filter((a) => a.owner === p.id);
      expect(armies).toHaveLength(2);
      for (const a of armies) {
        expect(a).toMatchObject({
          type: 'infantry',
          soldiers: 100_000,
          org: 100_000,
          order: 'expand',
        });
      }
    }
  });

  it('города и армии отсортированы по id без повторов', () => {
    for (const list of [state.cities, state.armies]) {
      const ids = list.map((x) => x.id);
      expect(ids).toEqual([...new Set(ids)].sort((a, b) => a - b));
    }
  });

  it('соседи столицы выбираются по лимиту населения, при равенстве — по порядку направлений', () => {
    const tinyMap = mapOf(tiny);
    const s = createMatch(tinyMap, players(1), SEED);
    const spawn = tinyMap.spawns[0] ?? { q: 0, r: 0 };
    const picked = pickStartNeighbors(s, spawn);
    expect(picked).toHaveLength(2);
    const caps = picked.map((id) => hexPopCap(s, id));
    expect(caps[0]).toBeGreaterThanOrEqual(caps[1] ?? 0);
  });

  it('спавны распределяются по сиду: разные сиды дают разные расстановки', () => {
    const capitalsFor = (seed: number): number[] => {
      const s = createMatch(map, players(6), seed);
      return s.players.map((p) => s.cities.find((c) => c.id === p.capitalCityId)?.hex ?? -1);
    };
    expect(capitalsFor(SEED)).toEqual(capitalsFor(SEED));
    const layouts = new Set([1, 2, 3, 4, 5].map((seed) => capitalsFor(seed).join(',')));
    expect(layouts.size).toBeGreaterThan(1);
  });

  it('отклоняет больше игроков, чем спавнов', () => {
    expect(() => createMatch(map, players(7), SEED)).toThrow(RangeError);
  });
});

describe('step', () => {
  it('вызывает 17 систем после applyCommands в порядке sim-core.md', () => {
    expect(SYSTEMS.map((f) => f.name)).toEqual([
      'taxSystem',
      'constructionSystem',
      'recruitSystem',
      'networkSystem',
      'supplySystem',
      'frontSystem',
      'offensiveSystem',
      'movementSystem',
      'artillerySystem',
      'combatSystem',
      'attritionSystem',
      'orgRegenSystem',
      'populationSystem',
      'economySystem',
      'capitalSystem',
      'visionSystem',
      'victorySystem',
    ]);
  });

  it('1000 тиков без команд дают одинаковый хэш в двух прогонах', () => {
    const run = (): string => {
      const s = createMatch(mapOf(small), players(6), SEED);
      for (let i = 0; i < 1000; i += 1) step(s, []);
      expect(s.tick).toBe(1000);
      return hashState(s);
    };
    expect(run()).toBe(run());
  });

  it('команды пока отклоняются с причиной notImplemented и не меняют состояние', () => {
    const a = createMatch(mapOf(tiny), players(2), SEED);
    const b = createMatch(mapOf(tiny), players(2), SEED);
    step(a, [{ playerId: 1, cmd: { t: 'bombard', armyId: 1, targetArmyId: null } }]);
    step(b, []);
    expect(a.events).toEqual([
      { t: 'commandRejected', playerId: 1, command: 'bombard', reason: 'notImplemented' },
    ]);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('команда несуществующего игрока отклоняется', () => {
    const s = createMatch(mapOf(tiny), players(2), SEED);
    step(s, [{ playerId: 5, cmd: { t: 'upgradeCity', cityId: 1 } }]);
    expect(s.events[0]).toMatchObject({ reason: 'unknownPlayer' });
  });

  it('команды применяются по playerId, внутри игрока — по порядку поступления', () => {
    const s = createMatch(mapOf(tiny), players(2), SEED);
    step(s, [
      { playerId: 1, cmd: { t: 'upgradeCity', cityId: 1 } },
      { playerId: 0, cmd: { t: 'improve', hex: 3 } },
      { playerId: 1, cmd: { t: 'foundCity', hex: 4 } },
    ]);
    const rejected = s.events.flatMap((e) =>
      e.t === 'commandRejected' ? [[e.playerId, e.command]] : [],
    );
    expect(rejected).toEqual([
      [0, 'improve'],
      [1, 'upgradeCity'],
      [1, 'foundCity'],
    ]);
  });

  it('события очищаются в начале каждого тика', () => {
    const s = createMatch(mapOf(tiny), players(2), SEED);
    step(s, [{ playerId: 0, cmd: { t: 'upgradeCity', cityId: 1 } }]);
    step(s, []);
    expect(s.events).toEqual([]);
  });
});

describe('hashState', () => {
  it('меняется при изменении любого поля состояния', () => {
    const base = (): ReturnType<typeof createMatch> => createMatch(mapOf(tiny), players(2), SEED);
    const h0 = hashState(base());
    const mutations: ((s: ReturnType<typeof createMatch>) => void)[] = [
      (s) => (s.tick += 1),
      (s) => (s.hexes.pop[0] = 1),
      (s) => (s.hexes.owner[0] = 1),
      (s) => ((s.players[0] as { gold: number }).gold += 1),
      (s) => ((s.armies[0] as { org: number }).org -= 1),
      (s) => ((s.cities[0] as { level: number }).level += 1),
    ];
    for (const mutate of mutations) {
      const s = base();
      mutate(s);
      expect(hashState(s)).not.toBe(h0);
    }
  });
});
