import { afterEach, describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { botCommands, commanderCommands } from '../src/bots/run.ts';
import { loadMap } from '../src/map/load.ts';
import { createMatch } from '../src/state/create-match.ts';
import { configureDerivedAudit, derivedStats, memo } from '../src/state/derived.ts';
import { touchLayer } from '../src/state/layers.ts';
import { step } from '../src/step.ts';
import { cityCoverage } from '../src/systems/city-coverage.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const MAP = loaded.map;

const match = () =>
  createMatch(
    MAP,
    Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })),
    11,
  );

// Аудит в этих тестах настраивается явно; после теста возвращаем общую настройку пакета.
afterEach(() => configureDerivedAudit(5));

describe('реестр кэшей производных данных', () => {
  it('пересчитывает только при смене версии слоя', () => {
    const state = match();
    let calls = 0;
    const read = () =>
      memo(state, 'тест', ['road'], () => {
        calls += 1;
        return calls;
      });
    expect(read()).toBe(1);
    expect(read()).toBe(1);
    touchLayer(state, 'road');
    expect(read()).toBe(2);
    touchLayer(state, 'owner');
    expect(read()).toBe(2);
    expect(derivedStats(state).get('тест')).toEqual({ hits: 2, recomputes: 2 });
  });

  it('аудит ловит запись в слой в обход state/layers.ts', () => {
    const state = match();
    configureDerivedAudit(1);
    cityCoverage(state);
    const victim = state.hexes.owner.findIndex((owner) => owner >= 0);
    // Нарочный обход: владелец меняется без повышения версии слоя.
    state.hexes.owner[victim] = -1;
    expect(() => cityCoverage(state)).toThrowError(/Кэш «cityCoverage» устарел/);
  });

  it('контракт производительности: кэши работают в матче ботов, а не пересчитываются каждый раз', () => {
    const state = match();
    const bots = state.players.map((p) => p.id);
    for (let tick = 0; tick < 600; tick += 1) {
      step(state, [...commanderCommands(state, bots), ...botCommands(state, bots)]);
    }
    const stats = derivedStats(state);
    const mask = stats.get('nearCityMask');
    // Города только добавляются: маска пересчитывается не чаще, чем появляется город.
    expect(mask?.recomputes ?? 0).toBeLessThanOrEqual(state.cities.length);
    expect(mask?.hits ?? 0).toBeGreaterThan((mask?.recomputes ?? 1) * 20);
    const coverage = stats.get('cityCoverage');
    // Покрытие пересчитывается при смене владельцев и городов; без изменений — из кэша.
    expect(coverage?.hits ?? 0).toBeGreaterThanOrEqual(coverage?.recomputes ?? 0);
  });
});
