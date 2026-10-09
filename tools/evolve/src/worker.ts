import { parentPort, workerData } from 'node:worker_threads';

import { evaluateWeights } from './evaluate.ts';
import type { CandidateEvaluation, EvolutionWeights } from './types.ts';

interface WorkerData {
  readonly index: number;
  readonly weights: EvolutionWeights;
  readonly seeds: readonly number[];
  readonly ticks: number;
}

const data = workerData as WorkerData;
const result: CandidateEvaluation = {
  index: data.index,
  fitness: evaluateWeights(data.weights, data.seeds, data.ticks),
};
parentPort?.postMessage(result);
