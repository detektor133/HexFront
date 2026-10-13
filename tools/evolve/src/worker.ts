import { parentPort, workerData } from 'node:worker_threads';

import { evaluateExamMatch, evaluateMatch } from './evaluate.ts';
import type { CandidateMatch, EvolutionMap, EvolutionWeights } from './types.ts';

interface CandidateWorkerData {
  readonly kind: 'candidate';
  readonly index: number;
  readonly weights: EvolutionWeights;
  readonly opponents: readonly { readonly weights: EvolutionWeights; readonly slot: number }[];
  readonly candidateSlot: number;
  readonly seed: number;
  readonly ticks: number;
  readonly map: EvolutionMap;
}

interface ExamWorkerData {
  readonly kind: 'exam';
  readonly weights: EvolutionWeights;
  readonly seed: number;
  readonly ticks: number;
  readonly map: EvolutionMap;
}

type WorkerData = CandidateWorkerData | ExamWorkerData;

const data = workerData as WorkerData;
if (data.kind === 'exam') {
  const evaluation = evaluateExamMatch(data.weights, data.seed, data.ticks, data.map);
  parentPort?.postMessage({
    seed: data.seed,
    fitness: evaluation.fitness,
    place: 0,
    goldOver5000S: evaluation.maxGoldOver5000S,
    unitUnder10S: evaluation.maxUnitUnder10S,
    won: evaluation.won,
    endTick: evaluation.endTick,
    leaderCities: evaluation.leaderCities,
    neededCities: evaluation.neededCities,
  });
} else {
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
}
