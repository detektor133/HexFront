import {
  FP,
  TICKS_PER_S,
  VICTORY_CITY_SHARE,
  type WinReason,
} from '../../../packages/sim/src/index.ts';
import { intDiv } from '../../../packages/sim/src/math/int.ts';

export interface AcceptanceTick {
  readonly gold: readonly number[];
  readonly unitSoldiers: readonly (readonly number[])[];
}

export interface MatchAcceptance {
  readonly maxGoldOver5000S: number;
  readonly maxUnitUnder10S: number;
  readonly goldOver5000SByPlayer: readonly number[];
  readonly unitUnder10SByPlayer: readonly number[];
  readonly winner: number;
  readonly winReason: WinReason | null;
  readonly endTick: number;
}

export interface FitnessMetrics {
  readonly place: number;
  readonly maxGoldOver5000S: number;
  readonly maxUnitUnder10S: number;
  readonly won: boolean;
  readonly cities: number;
  readonly totalCities: number;
}

export interface ExamFitnessMetrics {
  readonly won: boolean;
  readonly leaderCities: number;
  readonly neededCities: number;
  readonly maxGoldOver5000S: number;
  readonly maxUnitUnder10S: number;
}

/** Считает непрерывные интервалы критериев T1 по снимкам тиков матча. */
export function calculateBotAcceptance(
  ticks: readonly AcceptanceTick[],
  outcome: Omit<
    MatchAcceptance,
    'maxGoldOver5000S' | 'maxUnitUnder10S' | 'goldOver5000SByPlayer' | 'unitUnder10SByPlayer'
  >,
): MatchAcceptance {
  const goldRuns = new Array<number>(ticks[0]?.gold.length ?? 0).fill(0);
  const unitRuns = new Array<number>(goldRuns.length).fill(0);
  const maxGoldRuns = new Array<number>(goldRuns.length).fill(0);
  const maxUnitRuns = new Array<number>(goldRuns.length).fill(0);
  for (const tick of ticks) {
    for (let playerId = 0; playerId < goldRuns.length; playerId += 1) {
      const units = tick.unitSoldiers[playerId] ?? [];
      goldRuns[playerId] =
        (tick.gold[playerId] ?? 0) > 5000 * FP ? (goldRuns[playerId] ?? 0) + 1 : 0;
      unitRuns[playerId] = units.some((soldiers) => soldiers < 10 * FP)
        ? (unitRuns[playerId] ?? 0) + 1
        : 0;
      maxGoldRuns[playerId] = Math.max(maxGoldRuns[playerId] ?? 0, goldRuns[playerId] ?? 0);
      maxUnitRuns[playerId] = Math.max(maxUnitRuns[playerId] ?? 0, unitRuns[playerId] ?? 0);
    }
  }
  return {
    ...outcome,
    maxGoldOver5000S: Math.max(...maxGoldRuns, 0) / TICKS_PER_S,
    maxUnitUnder10S: Math.max(...maxUnitRuns, 0) / TICKS_PER_S,
    goldOver5000SByPlayer: maxGoldRuns.map((ticks) => ticks / TICKS_PER_S),
    unitUnder10SByPlayer: maxUnitRuns.map((ticks) => ticks / TICKS_PER_S),
  };
}

/** Считает целочисленный fitness одной особи в одном матче. */
export function calculateFitness(metrics: FitnessMetrics): number {
  const goldPenalty = calculatePenalty(metrics.maxGoldOver5000S, 120);
  const unitPenalty = calculatePenalty(metrics.maxUnitUnder10S, 30);
  const neededCities = Math.ceil((VICTORY_CITY_SHARE * metrics.totalCities) / FP);
  const progress =
    neededCities > 0 ? intDiv(3000 * Math.min(metrics.cities, neededCities), neededCities) : 0;
  return (
    1000 * (6 - metrics.place) + progress + (metrics.won ? 3000 : 0) - goldPenalty - unitPenalty
  );
}

/** Считает экзаменационный fitness без места особи в матче. */
export function calculateExamFitness(metrics: ExamFitnessMetrics): number {
  const progress =
    metrics.neededCities > 0
      ? intDiv(3000 * Math.min(metrics.leaderCities, metrics.neededCities), metrics.neededCities)
      : 0;
  return (
    (metrics.won ? 3000 : 0) +
    progress -
    calculatePenalty(metrics.maxGoldOver5000S, 120) -
    calculatePenalty(metrics.maxUnitUnder10S, 30)
  );
}

export function calculatePenalty(seconds: number, limit: number): number {
  return Math.min(1000, intDiv(1000 * Math.max(0, seconds - limit), 1500 - limit));
}
