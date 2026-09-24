// Рост и убыль населения по гексам.
// GDD: docs/gdd/02-economy.md — «Население»
import {
  CITY_LEVEL_GROWTH_STEP,
  GROWTH_CITY_HEX,
  GROWTH_RING1,
  GROWTH_RING2,
  IMPROVEMENT_GROWTH_STEP,
  ISOLATED_GROWTH_MULT,
  POP_OVERCAP_DECAY,
  TICKS_PER_S,
} from '../balance.ts';
import { taxGrowthMult } from './tax.ts';
import { hexId, inBounds, ring, hexFromId } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { isCityIsolated } from '../state/network.ts';
import { cityPopCap, hexPopCap } from '../state/pop-cap.ts';
import { NEUTRAL, type MatchState } from '../state/types.ts';

/** Базовый рост по кольцу от города: сам город, кольцо 1, кольцо 2 (людей/с). */
const BASE_GROWTH: readonly Fp[] = [GROWTH_CITY_HEX, GROWTH_RING1, GROWTH_RING2];

/**
 * Множитель уровня города: cityLevelMult = 1 + 0,25 × (level − 1).
 * @returns fixed-point
 */
export function cityLevelMult(level: number): Fp {
  return (FP + CITY_LEVEL_GROWTH_STEP * (level - 1)) as Fp;
}

// Для каждого гекса — лучшая «городская» часть роста: baseGrowth(ring) × cityLevelMult × networkMult.
// Остальные множители одинаковы для всех городов гекса, поэтому максимум берётся по этой части.
function bestCityGrowth(state: MatchState): Int32Array {
  const { map, hexes } = state;
  const best = new Int32Array(map.width * map.height);
  for (const c of state.cities) {
    if (c.owner === NEUTRAL) continue;
    const networkMult = isCityIsolated(state, c.id) ? ISOLATED_GROWTH_MULT : (FP as Fp);
    const cityPart = fpMul(cityLevelMult(c.level), networkMult);
    const center = hexFromId(c.hex, map.width);
    BASE_GROWTH.forEach((base, k) => {
      for (const h of ring(center, k)) {
        if (!inBounds(h, map.width, map.height)) continue;
        const id = hexId(h, map.width);
        if (hexes.owner[id] !== c.owner) continue;
        const g = fpMul(base, cityPart);
        if (g > (best[id] ?? 0)) best[id] = g;
      }
    });
  }
  return best;
}

function cityLevels(state: MatchState): Uint8Array {
  const levels = new Uint8Array(state.map.width * state.map.height);
  for (const c of state.cities) levels[c.hex] = c.level;
  return levels;
}

/**
 * Рост в радиусе 2 от своих городов (максимум по городам), убыль 1 %/с сверх лимита:
 * growth/с = baseGrowth(ring) × cityLevelMult × improvementGrowthMult × taxGrowthMult
 *            × networkMult × (1 − pop / popCap)
 */
export function populationSystem(state: MatchState): void {
  const { hexes } = state;
  const best = bestCityGrowth(state);
  const levels = cityLevels(state);
  for (let id = 0; id < hexes.pop.length; id += 1) {
    const pop = hexes.pop[id] ?? 0;
    const level = levels[id] ?? 0;
    const cap = level > 0 ? cityPopCap(level) : hexPopCap(state, id);
    if (pop > cap) {
      const decay = intDiv(fpMul(pop as Fp, POP_OVERCAP_DECAY), TICKS_PER_S);
      hexes.pop[id] = Math.max(cap, pop - decay);
      continue;
    }
    const cityPart = best[id] ?? 0;
    const player = state.players[hexes.owner[id] ?? NEUTRAL];
    if (cityPart === 0 || !player || pop === cap) continue;
    const improvement = (FP + IMPROVEMENT_GROWTH_STEP * (hexes.improvement[id] ?? 0)) as Fp;
    const full = fpMul(fpMul(cityPart as Fp, improvement), taxGrowthMult(player.taxEffective));
    // Одно деление в конце: доля (1 − pop/cap) и перевод в тики без промежуточного округления.
    const growth = intDiv(full * (cap - pop), cap * TICKS_PER_S);
    hexes.pop[id] = Math.min(cap, pop + growth);
  }
}
