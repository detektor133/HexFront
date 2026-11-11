import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import { GROWTH_BACKGROUND, ISOLATED_GROWTH_MULT } from '../src/balance.ts';
import { commanderCommands } from '../src/bots/run.ts';
import { loadMap } from '../src/map/load.ts';
import { hexFromId, hexId, inBounds, ring, spiral } from '../src/math/hex.ts';
import { FP, fpMul, type Fp } from '../src/math/int.ts';
import { createMatch } from '../src/state/create-match.ts';
import { setHexOwner } from '../src/state/hex-owner.ts';
import { setCityLevel } from '../src/state/layers.ts';
import { isCityIsolated } from '../src/state/network.ts';
import { NEUTRAL, type MatchState } from '../src/state/types.ts';
import { step } from '../src/step.ts';
import { BASE_GROWTH, cityCoverage, cityLevelMult } from '../src/systems/city-coverage.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const MAP = loaded.map;

// Эталон: прежняя реализация через кольца и спираль гексов (объект на гекс), без кэша.
function referenceBest(state: MatchState): Int32Array {
  const { map, hexes } = state;
  const best = new Int32Array(map.width * map.height);
  for (const c of state.cities) {
    if (c.owner === NEUTRAL) continue;
    const center = hexFromId(c.hex, map.width);
    BASE_GROWTH.forEach((base, k) => {
      const mult = isCityIsolated(state, c.id) ? ISOLATED_GROWTH_MULT : (FP as Fp);
      const g = fpMul(base, fpMul(cityLevelMult(c.level), mult));
      for (const h of ring(center, k)) {
        if (!inBounds(h, map.width, map.height)) continue;
        const id = hexId(h, map.width);
        if (hexes.owner[id] === c.owner && g > (best[id] ?? 0)) best[id] = g;
      }
    });
  }
  hexes.owner.forEach((o, id) => {
    if (o !== NEUTRAL && (best[id] ?? 0) === 0) best[id] = GROWTH_BACKGROUND;
  });
  return best;
}

function referenceCut(state: MatchState): Uint8Array {
  const { width, height } = state.map;
  const covered = new Uint8Array(width * height);
  const connected = new Uint8Array(width * height);
  for (const c of state.cities) {
    if (c.owner === NEUTRAL) continue;
    const isMain = !isCityIsolated(state, c.id);
    for (const h of spiral(hexFromId(c.hex, width), 2)) {
      if (!inBounds(h, width, height)) continue;
      const id = hexId(h, width);
      if (state.hexes.owner[id] !== c.owner) continue;
      covered[id] = 1;
      if (isMain) connected[id] = 1;
    }
  }
  return covered.map((cov, id) => (cov === 1 && connected[id] === 0 ? 1 : 0));
}

function match(): MatchState {
  return createMatch(
    MAP,
    Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })),
    11,
  );
}

describe('покрытие городов (кэш роста и изоляции)', () => {
  it('совпадает с эталоном кольцами и спиралью на всём протяжении матча', () => {
    const state = match();
    for (let tick = 0; tick < 500; tick += 1) {
      step(state, commanderCommands(state));
      if (tick % 25 !== 0) continue;
      const coverage = cityCoverage(state);
      expect(coverage.best).toEqual(referenceBest(state));
      expect(coverage.cut).toEqual(referenceCut(state));
    }
  }, 60_000);

  it('повторный вызов на том же состоянии отдаёт тот же результат без пересчёта', () => {
    const state = match();
    expect(cityCoverage(state)).toBe(cityCoverage(state));
  });

  it('смена владельца гекса или уровня города сбрасывает кэш', () => {
    const state = match();
    const before = cityCoverage(state);
    const city = state.cities.find((c) => c.owner !== NEUTRAL);
    if (!city) throw new Error('нет города игрока');
    const ownOther = state.hexes.owner.findIndex((o, id) => o === city.owner && id !== city.hex);
    setHexOwner(state, ownOther, NEUTRAL);
    const afterOwner = cityCoverage(state);
    expect(afterOwner).not.toBe(before);
    expect(afterOwner.best).toEqual(referenceBest(state));
    setCityLevel(state, city, city.level + 1);
    const afterLevel = cityCoverage(state);
    expect(afterLevel).not.toBe(afterOwner);
    expect(afterLevel.best).toEqual(referenceBest(state));
  });
});
