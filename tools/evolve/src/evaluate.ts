import { readFileSync } from 'node:fs';

import type { EvolutionWeights } from './types.ts';
import type { EvolutionMap } from './types.ts';
import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  FP,
  loadMap,
  playerPlaces,
  playerScores,
  step,
  VICTORY_CITY_SHARE,
  type MatchState,
  type WinReason,
} from '../../../packages/sim/src/index.ts';
import type { MapStatic } from '../../../packages/sim/src/map/types.ts';
import {
  calculateBotAcceptance,
  calculateExamFitness,
  calculateFitness,
  type AcceptanceTick,
} from '../../replay/src/acceptance.ts';

const PLAYERS = 6;

export function candidateSlotForSeed(baseSlot: number, seed: number): number {
  return (baseSlot + seed) % PLAYERS;
}

export interface MatchOpponent {
  readonly weights: EvolutionWeights;
  readonly slot: number;
}

export function loadEvolutionMap(seed: number, map: EvolutionMap = 'small'): MapStatic {
  if (map === 'gen') {
    const loaded = loadMap(generateMap(seed, { width: 80, height: 60, players: PLAYERS }));
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    return loaded.map;
  }
  const source = JSON.parse(
    readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
  ) as unknown;
  const loaded = loadMap(source);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  return loaded.map;
}

function acceptanceTrace(state: MatchState): AcceptanceTick {
  return {
    gold: state.players.map((player) => player.gold),
    unitSoldiers: state.players.map((player) =>
      state.units.filter((unit) => unit.owner === player.id).map((unit) => unit.soldiers),
    ),
  };
}

export interface CandidateFitnessMetrics {
  readonly place: number;
  readonly goldOver5000S: number;
  readonly unitUnder10S: number;
  readonly won: boolean;
  readonly cities?: number;
  readonly totalCities?: number;
}

export function calculateCandidateFitness(metrics: CandidateFitnessMetrics): number {
  return calculateFitness({
    place: metrics.place,
    maxGoldOver5000S: metrics.goldOver5000S,
    maxUnitUnder10S: metrics.unitUnder10S,
    won: metrics.won,
    cities: metrics.cities ?? 0,
    totalCities: metrics.totalCities ?? 0,
  });
}

export interface MatchEvaluation {
  readonly fitness: number;
  readonly maxGoldOver5000S: number;
  readonly maxUnitUnder10S: number;
  readonly endTick: number;
  readonly place: number;
  readonly won: boolean;
  readonly cities: number;
}

export interface ExamMatchEvaluation {
  readonly fitness: number;
  readonly endTick: number;
  readonly won: boolean;
  readonly leaderCities: number;
  readonly neededCities: number;
  readonly maxGoldOver5000S: number;
  readonly maxUnitUnder10S: number;
}

interface SimulatedMatch {
  readonly state: MatchState;
  readonly acceptance: ReturnType<typeof calculateBotAcceptance>;
  readonly winReason: WinReason | null;
}

function simulateMatch(
  weights: EvolutionWeights,
  opponents: readonly MatchOpponent[],
  seed: number,
  ticks: number,
  candidateSlot: number,
  map: EvolutionMap,
): SimulatedMatch {
  const evolutionMap = loadEvolutionMap(seed, map);
  const state = createMatch(
    evolutionMap,
    Array.from({ length: PLAYERS }, (_, id) => ({ name: `P${id}` })),
    seed,
    { fog: false },
  );
  const actualCandidateSlot = candidateSlotForSeed(candidateSlot, seed);
  const slots = Array.from({ length: PLAYERS }, () => weights);
  const opponentSlots = Array.from({ length: PLAYERS }, (_, slot) => slot).filter(
    (slot) => slot !== actualCandidateSlot,
  );
  opponents.forEach((opponent, index) => {
    const slot = opponentSlots[index];
    if (slot !== undefined) slots[slot] = opponent.weights;
  });
  slots[actualCandidateSlot] = weights;
  const traces: AcceptanceTick[] = [];
  const bots = state.players.map((player) => player.id);
  let winReason: WinReason | null = null;
  for (let tick = 0; tick < ticks && state.winner < 0; tick += 1) {
    const context = createBotTickContext(state);
    step(state, [
      ...commanderCommands(state, bots, context, undefined, slots),
      ...botCommands(state, bots, context, undefined, slots),
    ]);
    traces.push(acceptanceTrace(state));
    const event = state.events.find((item) => item.t === 'matchWon');
    if (event?.t === 'matchWon') winReason = event.reason;
  }
  return {
    state,
    acceptance: calculateBotAcceptance(traces, {
      winner: state.winner,
      winReason,
      endTick: state.tick,
    }),
    winReason,
  };
}

export function evaluateMatch(
  weights: EvolutionWeights,
  opponents: readonly MatchOpponent[],
  seed: number,
  ticks: number,
  candidateSlot: number,
  map: EvolutionMap = 'small',
): MatchEvaluation {
  const simulated = simulateMatch(weights, opponents, seed, ticks, candidateSlot, map);
  const { state, acceptance, winReason } = simulated;
  const actualCandidateSlot = candidateSlotForSeed(candidateSlot, seed);
  const places = playerPlaces(state, playerScores(state));
  return {
    fitness: calculateCandidateFitness({
      place: places[actualCandidateSlot] ?? PLAYERS,
      goldOver5000S: acceptance.goldOver5000SByPlayer[actualCandidateSlot] ?? 0,
      unitUnder10S: acceptance.unitUnder10SByPlayer[actualCandidateSlot] ?? 0,
      won:
        state.winner === actualCandidateSlot &&
        (winReason === 'cities' || winReason === 'lastStanding'),
      cities: state.cities.filter((city) => city.owner === actualCandidateSlot).length,
      totalCities: state.cities.length,
    }),
    maxGoldOver5000S: acceptance.goldOver5000SByPlayer[actualCandidateSlot] ?? 0,
    maxUnitUnder10S: acceptance.unitUnder10SByPlayer[actualCandidateSlot] ?? 0,
    endTick: acceptance.endTick,
    place: places[actualCandidateSlot] ?? PLAYERS,
    cities: state.cities.filter((city) => city.owner === actualCandidateSlot).length,
    won:
      state.winner === actualCandidateSlot &&
      (winReason === 'cities' || winReason === 'lastStanding'),
  };
}

export function evaluateExamMatch(
  weights: EvolutionWeights,
  seed: number,
  ticks: number,
  map: EvolutionMap = 'small',
): ExamMatchEvaluation {
  const { state, acceptance, winReason } = simulateMatch(weights, [], seed, ticks, 0, map);
  const leaderCities = Math.max(
    ...state.players.map(
      (player) => state.cities.filter((city) => city.owner === player.id).length,
    ),
    0,
  );
  const neededCities = Math.ceil((VICTORY_CITY_SHARE * state.cities.length) / FP);
  const won = state.winner >= 0 && (winReason === 'cities' || winReason === 'lastStanding');
  return {
    fitness: calculateExamFitness({
      won,
      leaderCities,
      neededCities,
      maxGoldOver5000S: acceptance.maxGoldOver5000S,
      maxUnitUnder10S: acceptance.maxUnitUnder10S,
    }),
    endTick: acceptance.endTick,
    won,
    leaderCities,
    neededCities,
    maxGoldOver5000S: acceptance.maxGoldOver5000S,
    maxUnitUnder10S: acceptance.maxUnitUnder10S,
  };
}

export function evaluateWeightsDetailed(
  weights: EvolutionWeights,
  seeds: readonly number[],
  ticks: number,
  opponents: readonly MatchOpponent[] = [],
  candidateSlot = 0,
  map: EvolutionMap = 'small',
): MatchEvaluation {
  const matches = seeds.map((seed) =>
    evaluateMatch(weights, opponents, seed, ticks, candidateSlot, map),
  );
  return matches.reduce(
    (total, result) => {
      return {
        fitness: total.fitness + result.fitness,
        maxGoldOver5000S: Math.max(total.maxGoldOver5000S, result.maxGoldOver5000S),
        maxUnitUnder10S: Math.max(total.maxUnitUnder10S, result.maxUnitUnder10S),
        endTick: Math.max(total.endTick, result.endTick),
        place: Math.max(total.place, result.place),
        won: total.won || result.won,
        cities: Math.max(total.cities, result.cities),
      };
    },
    {
      fitness: 0,
      maxGoldOver5000S: 0,
      maxUnitUnder10S: 0,
      endTick: 0,
      place: 0,
      won: false,
      cities: 0,
    },
  );
}

/** Оценивает особь на детерминированных шестиместных матчах. */
export function evaluateWeights(
  weights: EvolutionWeights,
  seeds: readonly number[],
  ticks: number,
  opponents: readonly MatchOpponent[] = [],
  candidateSlot = 0,
): number {
  return evaluateWeightsDetailed(weights, seeds, ticks, opponents, candidateSlot).fitness;
}
