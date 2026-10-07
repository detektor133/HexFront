import { cityPopCap, hexPopCap } from './pop-cap.ts';
import { NEUTRAL, type MatchState } from './types.ts';
import { ANALYTIC_FP, decayDeficit } from '../math/exponential.ts';
import type { HexId } from '../math/hex.ts';
import { type Fp } from '../math/int.ts';

function capOf(state: MatchState, hex: HexId): Fp {
  const city = state.cities.find((candidate) => candidate.hex === hex);
  return city ? cityPopCap(city.level) : hexPopCap(state, hex);
}

function currentM(state: MatchState, hex: HexId): number {
  const owner = state.hexes.owner[hex] ?? NEUTRAL;
  return owner >= 0 ? (state.populationM[owner] ?? 0) : 0;
}

/**
 * Возвращает население гекса по якорю без изменения состояния.
 * @returns fixed-point людей
 */
export function populationAt(state: MatchState, hex: HexId): Fp {
  const anchor = state.hexes.populationAnchor[hex] ?? 0;
  const anchorM = state.hexes.populationAnchorM[hex] ?? 0;
  const deltaM = Math.max(0, currentM(state, hex) - anchorM);
  const deficit = decayDeficit(anchor, state.hexes.populationRate[hex] ?? 0, deltaM);
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
