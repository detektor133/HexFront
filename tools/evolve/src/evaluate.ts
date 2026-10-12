import type { EvolutionWeights } from './types.ts';
import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  loadMap,
  playerPlaces,
  playerScores,
  step,
  type MatchState,
  type WinReason,
} from '../../../packages/sim/src/index.ts';
import {
  calculateBotAcceptance,
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
}

export function calculateCandidateFitness(metrics: CandidateFitnessMetrics): number {
  return calculateFitness({
    place: metrics.place,
    maxGoldOver5000S: metrics.goldOver5000S,
    maxUnitUnder10S: metrics.unitUnder10S,
    won: metrics.won,
  });
}

export interface MatchEvaluation {
  readonly fitness: number;
  readonly maxGoldOver5000S: number;
  readonly maxUnitUnder10S: number;
  readonly endTick: number;
}

function evaluateMatch(
  weights: EvolutionWeights,
  opponents: readonly MatchOpponent[],
  seed: number,
  ticks: number,
  candidateSlot: number,
): MatchEvaluation {
  const loaded = loadMap(generateMap(seed, { width: 80, height: 60, players: PLAYERS }));
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const state = createMatch(
    loaded.map,
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
  const acceptance = calculateBotAcceptance(traces, {
    winner: state.winner,
    winReason,
    endTick: state.tick,
  });
  const places = playerPlaces(state, playerScores(state));
  return {
    fitness: calculateCandidateFitness({
      place: places[actualCandidateSlot] ?? PLAYERS,
      goldOver5000S: acceptance.goldOver5000SByPlayer[actualCandidateSlot] ?? 0,
      unitUnder10S: acceptance.unitUnder10SByPlayer[actualCandidateSlot] ?? 0,
      won:
        state.winner === actualCandidateSlot &&
        (winReason === 'cities' || winReason === 'lastStanding'),
    }),
    maxGoldOver5000S: acceptance.goldOver5000SByPlayer[actualCandidateSlot] ?? 0,
    maxUnitUnder10S: acceptance.unitUnder10SByPlayer[actualCandidateSlot] ?? 0,
    endTick: acceptance.endTick,
  };
}

export function evaluateWeightsDetailed(
  weights: EvolutionWeights,
  seeds: readonly number[],
  ticks: number,
  opponents: readonly MatchOpponent[] = [],
  candidateSlot = 0,
): MatchEvaluation {
  return seeds.reduce(
    (total, seed) => {
      const result = evaluateMatch(weights, opponents, seed, ticks, candidateSlot);
      return {
        fitness: total.fitness + result.fitness,
        maxGoldOver5000S: Math.max(total.maxGoldOver5000S, result.maxGoldOver5000S),
        maxUnitUnder10S: Math.max(total.maxUnitUnder10S, result.maxUnitUnder10S),
        endTick: Math.max(total.endTick, result.endTick),
      };
    },
    { fitness: 0, maxGoldOver5000S: 0, maxUnitUnder10S: 0, endTick: 0 },
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
