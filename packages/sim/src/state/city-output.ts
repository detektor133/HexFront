// Выработка города после захвата: 25 % → 100 % линейно за CAPTURED_RAMP_S.
// GDD: docs/gdd/03-cities-buildings.md — «Захват города».
import {
  CAPTURED_OUTPUT_START,
  CAPTURED_RAMP_S,
  CITY_GOLD_PER_LEVEL,
  ISOLATED_INCOME_MULT,
  TICKS_PER_S,
} from '../balance.ts';
import { isCityIsolated } from './network.ts';
import type { City, MatchState } from './types.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';

/** Длительность рампы выработки после захвата, тики. */
export const CAPTURE_RAMP_TICKS = intDiv(CAPTURED_RAMP_S * TICKS_PER_S, FP);

/**
 * Доля выработки города: CAPTURED_OUTPUT_START + (1 − START) × прошедшая доля рампы.
 * @returns fixed-point доля 0,25..1
 */
export function cityOutputMult(city: City): Fp {
  if (city.captureTicks <= 0) return FP as Fp;
  const elapsed = CAPTURE_RAMP_TICKS - city.captureTicks;
  return (CAPTURED_OUTPUT_START +
    intDiv((FP - CAPTURED_OUTPUT_START) * elapsed, CAPTURE_RAMP_TICKS)) as Fp;
}

/**
 * Золото города в секунду: CITY_GOLD_PER_LEVEL × уровень × выработка, в изолированной сети —
 * × ISOLATED_INCOME_MULT.
 * @returns fixed-point золота в секунду
 */
export function cityGold(state: MatchState, city: City): Fp {
  const raw = fpMul((CITY_GOLD_PER_LEVEL * city.level) as Fp, cityOutputMult(city));
  return isCityIsolated(state, city.id) ? fpMul(raw, ISOLATED_INCOME_MULT) : raw;
}
