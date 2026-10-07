import {
  GROWTH_BACKGROUND,
  GROWTH_CITY_HEX,
  GROWTH_RING1,
  GROWTH_RING2,
  CITY_LEVEL_GROWTH_STEP,
  IMPROVEMENT_GROWTH_STEP,
  ISOLATED_GROWTH_MULT,
  POP_OVERCAP_DECAY,
} from '../balance.ts';
import { isCityIsolated } from './network.ts';
import { cityPopCap, hexPopCap } from './pop-cap.ts';
import { NEUTRAL, type MatchState } from './types.ts';
import { unitIndex } from './unit-index.ts';
import { ANALYTIC_FP, decayDeficit, growthRate } from '../math/exponential.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, fpMul, type Fp } from '../math/int.ts';

const BASE_GROWTH: readonly Fp[] = [GROWTH_CITY_HEX, GROWTH_RING1, GROWTH_RING2];

function capOf(state: MatchState, hex: HexId): Fp {
  const city = unitIndex(state).cityByHex[hex];
  return city ? cityPopCap(city.level) : hexPopCap(state, hex);
}

function currentM(state: MatchState, hex: HexId): number {
  const owner = state.hexes.owner[hex] ?? NEUTRAL;
  return owner >= 0 ? (state.populationM[owner] ?? 0) : 0;
}

function normalPopulationRateForHex(
  state: MatchState,
  hex: HexId,
  isolatedCities?: ReadonlyMap<number, boolean>,
): number {
  const cap = capOf(state, hex);
  if (cap <= 0) return 0;
  const owner = state.hexes.owner[hex] ?? NEUTRAL;
  if (owner === NEUTRAL) return 0;
  const here = hexFromId(hex, state.map.width);
  let best = 0;
  for (const city of state.cities) {
    if (city.owner !== owner) continue;
    const ring = distance(hexFromId(city.hex, state.map.width), here);
    if (ring >= BASE_GROWTH.length) continue;
    const isolated = isolatedCities?.get(city.id) ?? isCityIsolated(state, city.id);
    const network = isolated ? ISOLATED_GROWTH_MULT : (FP as Fp);
    best = Math.max(
      best,
      fpMul(
        BASE_GROWTH[ring] ?? (0 as Fp),
        fpMul((FP + (city.level - 1) * CITY_LEVEL_GROWTH_STEP) as Fp, network),
      ),
    );
  }
  const cityPart = best === 0 ? GROWTH_BACKGROUND : best;
  const improvement = (FP + IMPROVEMENT_GROWTH_STEP * (state.hexes.improvement[hex] ?? 0)) as Fp;
  return growthRate(fpMul(cityPart as Fp, improvement), cap);
}

interface PopulationRateCache {
  readonly cityCount: number;
  readonly improvements: Uint8Array;
  readonly rates: Int32Array;
  readonly dirty: Set<HexId>;
}

const rateCache = new WeakMap<MatchState, PopulationRateCache>();

function populationRates(state: MatchState): Int32Array {
  const cached = rateCache.get(state);
  if (cached) {
    for (const hex of cached.dirty) cached.rates[hex] = normalPopulationRateForHex(state, hex);
    cached.dirty.clear();
    return cached.rates;
  }
  const rates = new Int32Array(state.hexes.owner.length);
  const isolatedCities = new Map(
    state.cities.map((city) => [city.id, isCityIsolated(state, city.id)]),
  );
  for (let hex = 0; hex < rates.length; hex += 1) {
    rates[hex] = normalPopulationRateForHex(state, hex, isolatedCities);
  }
  rateCache.set(state, {
    cityCount: state.cities.length,
    improvements: state.hexes.improvement.slice(),
    rates,
    dirty: new Set(),
  });
  return rates;
}

/** Обновляет ставку одного гекса после смены его владельца. */
export function invalidatePopulationRate(state: MatchState, hex: HexId): void {
  rateCache.get(state)?.dirty.add(hex);
}

/** Сбрасывает ставки после изменения владельца города. */
export function invalidatePopulationRates(state: MatchState): void {
  rateCache.delete(state);
}

/** Обновляет ставки всех гексов игрока после изменения его сети. */
export function invalidatePopulationRatesForPlayer(state: MatchState, playerId: number): void {
  const cached = rateCache.get(state);
  if (!cached) return;
  state.hexes.owner.forEach((owner, hex) => {
    if (owner === playerId) cached.dirty.add(hex);
  });
}

/**
 * Возвращает население гекса по якорю без изменения состояния.
 * @returns fixed-point людей
 */
export function populationAt(state: MatchState, hex: HexId): Fp {
  const cached = rateCache.get(state);
  if (cached?.cityCount !== state.cities.length) rateCache.delete(state);
  else if (cached && cached.improvements[hex] !== state.hexes.improvement[hex])
    cached.dirty.add(hex);
  const anchor = state.hexes.populationAnchor[hex] ?? 0;
  const anchorM = state.hexes.populationAnchorM[hex] ?? 0;
  const deltaM = Math.max(0, currentM(state, hex) - anchorM);
  const rate =
    anchor < 0 ? growthRate(POP_OVERCAP_DECAY, FP as Fp) : (populationRates(state)[hex] ?? 0);
  const deficit = decayDeficit(anchor, rate, deltaM);
  return (capOf(state, hex) - deficit) as Fp;
}

/** Материализует текущее население в новый якорь, не меняя наблюдаемое значение. */
export function materializePopulation(state: MatchState, hex: HexId): void {
  const pop = populationAt(state, hex);
  const owner = state.hexes.owner[hex] ?? NEUTRAL;
  state.hexes.populationAnchor[hex] = capOf(state, hex) - pop;
  state.hexes.populationAnchorM[hex] = owner >= 0 ? (state.populationM[owner] ?? 0) : 0;
}

/** Записывает население как новое состояние якоря после события. */
export function setPopulation(state: MatchState, hex: HexId, pop: number): void {
  const owner = state.hexes.owner[hex] ?? NEUTRAL;
  state.hexes.pop[hex] = pop;
  state.hexes.populationAnchor[hex] = capOf(state, hex) - pop;
  state.hexes.populationAnchorM[hex] = owner >= 0 ? (state.populationM[owner] ?? 0) : 0;
}

/** Устанавливает коэффициент класса роста с сохранением текущего населения. */
export function setPopulationRate(state: MatchState, hex: HexId, rate: number): void {
  const pop = populationAt(state, hex);
  if ((state.hexes.populationRate[hex] ?? 0) === rate) return;
  const owner = state.hexes.owner[hex] ?? NEUTRAL;
  state.hexes.populationAnchor[hex] = capOf(state, hex) - pop;
  state.hexes.populationAnchorM[hex] = owner >= 0 ? (state.populationM[owner] ?? 0) : 0;
  state.hexes.populationRate[hex] = rate;
}

/** Создаёт якоря из стартового населения до первого тика симуляции. */
export function initializePopulationState(state: MatchState): void {
  state.populationM.splice(0, state.populationM.length, ...state.players.map(() => 0));
  for (let hex = 0; hex < state.hexes.pop.length; hex += 1) {
    state.hexes.populationAnchor[hex] = capOf(state, hex) - (state.hexes.pop[hex] ?? 0);
    state.hexes.populationAnchorM[hex] = 0;
    state.hexes.populationRate[hex] = 0;
  }
}

/** Возвращает якорный дефицит в масштабе аналитической математики. */
export function populationAnchorValue(state: MatchState, hex: HexId): number {
  return (state.hexes.populationAnchor[hex] ?? 0) * ANALYTIC_FP;
}
