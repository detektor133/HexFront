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
import { distance, hexFromId, hexId, inBounds, ring } from '../math/hex.ts';
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

// «Городская» часть роста: baseGrowth(ring) × cityLevelMult × networkMult.
// Остальные множители одинаковы для всех городов гекса, поэтому максимум берётся по этой части.
function cityGrowthPart(
  state: MatchState,
  cityId: number,
  level: number,
  ringIndex: number,
): number {
  const networkMult = isCityIsolated(state, cityId) ? ISOLATED_GROWTH_MULT : (FP as Fp);
  return fpMul(BASE_GROWTH[ringIndex] ?? (0 as Fp), fpMul(cityLevelMult(level), networkMult));
}

function bestCityGrowth(state: MatchState): Int32Array {
  const { map, hexes } = state;
  const best = new Int32Array(map.width * map.height);
  for (const c of state.cities) {
    if (c.owner === NEUTRAL) continue;
    const center = hexFromId(c.hex, map.width);
    BASE_GROWTH.forEach((_, k) => {
      const g = cityGrowthPart(state, c.id, c.level, k);
      for (const h of ring(center, k)) {
        if (!inBounds(h, map.width, map.height)) continue;
        const id = hexId(h, map.width);
        if (hexes.owner[id] === c.owner && g > (best[id] ?? 0)) best[id] = g;
      }
    });
  }
  return best;
}

// Рост до деления на время: fullGrowth × (cap − pop) / cap даёт людей/с в fixed-point.
function fullGrowth(state: MatchState, id: number, cityPart: number): number {
  const player = state.players[state.hexes.owner[id] ?? NEUTRAL];
  if (cityPart === 0 || !player) return 0;
  const improvement = (FP + IMPROVEMENT_GROWTH_STEP * (state.hexes.improvement[id] ?? 0)) as Fp;
  return fpMul(fpMul(cityPart as Fp, improvement), taxGrowthMult(player.taxEffective));
}

/**
 * Скорость изменения населения гекса: рост по формуле GDD или убыль 1 %/с сверх лимита.
 * @returns fixed-point людей в секунду (отрицательное — убыль)
 */
export function hexGrowthPerSecond(state: MatchState, hex: number): number {
  const { width } = state.map;
  const city = state.cities.find((c) => c.hex === hex);
  const cap = city ? cityPopCap(city.level) : hexPopCap(state, hex);
  const pop = state.hexes.pop[hex] ?? 0;
  if (pop > cap) return -fpMul(pop as Fp, POP_OVERCAP_DECAY);
  const here = hexFromId(hex, width);
  let best = 0;
  for (const c of state.cities) {
    const d = distance(hexFromId(c.hex, width), here);
    if (c.owner !== state.hexes.owner[hex] || c.owner === NEUTRAL || d >= BASE_GROWTH.length)
      continue;
    best = Math.max(best, cityGrowthPart(state, c.id, c.level, d));
  }
  if (pop === cap || cap === 0) return 0;
  return intDiv(fullGrowth(state, hex, best) * (cap - pop), cap);
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
    const full = fullGrowth(state, id, best[id] ?? 0);
    if (full === 0 || pop === cap) continue;
    // Одно деление в конце: доля (1 − pop/cap) и перевод в тики без промежуточного округления.
    const growth = intDiv(full * (cap - pop), cap * TICKS_PER_S);
    hexes.pop[id] = Math.min(cap, pop + growth);
  }
}
