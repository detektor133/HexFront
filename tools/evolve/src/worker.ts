import { parentPort, workerData } from 'node:worker_threads';

import { evaluateMatch } from './evaluate.ts';
import type { CandidateMatch, EvolutionMap, EvolutionWeights } from './types.ts';

interface WorkerData {
  readonly index: number;
  readonly weights: EvolutionWeights;
  readonly opponents: readonly { readonly weights: EvolutionWeights; readonly slot: number }[];
  readonly candidateSlot: number;
  readonly seed: number;
  readonly ticks: number;
  readonly map: EvolutionMap;
}

const data = workerData as WorkerData;
const evaluation = evaluateMatch(
  data.weights,
  data.opponents,
  data.seed,
  data.ticks,
  data.candidateSlot,
  data.map,
);
const match: CandidateMatch = {
  fitness: evaluation.fitness,
  place: evaluation.place,
  goldOver5000S: evaluation.maxGoldOver5000S,
  unitUnder10S: evaluation.maxUnitUnder10S,
  won: evaluation.won,
  endTick: evaluation.endTick,
};
parentPort?.postMessage({ index: data.index, seed: data.seed, match });
