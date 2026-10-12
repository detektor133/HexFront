import { parentPort, workerData } from 'node:worker_threads';

import { evaluateWeightsDetailed } from './evaluate.ts';
import type { CandidateEvaluation, EvolutionWeights } from './types.ts';

interface WorkerData {
  readonly index: number;
  readonly weights: EvolutionWeights;
  readonly opponents: readonly { readonly weights: EvolutionWeights; readonly slot: number }[];
  readonly candidateSlot: number;
  readonly seeds: readonly number[];
  readonly ticks: number;
}

const data = workerData as WorkerData;
const evaluation = evaluateWeightsDetailed(
  data.weights,
  data.seeds,
  data.ticks,
  data.opponents,
  data.candidateSlot,
);
const result: CandidateEvaluation = { index: data.index, ...evaluation };
parentPort?.postMessage(result);
