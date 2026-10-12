export type EvolutionWeights = Record<string, number>;
export type EvolutionMap = 'small' | 'gen';

export interface EvolutionOptions {
  readonly population: number;
  readonly seeds: number;
  readonly generations: number;
  readonly workers: number;
  readonly sigma?: number;
  readonly easyGeneration?: number;
  readonly ticks: number;
  readonly map?: EvolutionMap;
  readonly weightsPath: string;
  readonly easyWeightsPath?: string;
  readonly statePath: string;
  readonly reportDirectory: string;
  readonly resumePath?: string;
}

export interface EvolutionResult {
  readonly generation: number;
  readonly fitness: number;
  readonly weights: EvolutionWeights;
  readonly averageFitness?: number;
  readonly metrics?: {
    readonly maxGoldOver5000S: number;
    readonly maxUnitUnder10S: number;
    readonly endTick: number;
    readonly places: readonly number[];
    readonly wins: number;
    readonly populationWins: number;
    readonly averagePlace: number;
  };
}

export interface CandidateEvaluation {
  readonly index: number;
  readonly fitness: number;
  readonly maxGoldOver5000S: number;
  readonly maxUnitUnder10S: number;
  readonly endTick: number;
  readonly matches: readonly CandidateMatch[];
}

export interface CandidateMatch {
  readonly fitness: number;
  readonly place: number;
  readonly goldOver5000S: number;
  readonly unitUnder10S: number;
  readonly won: boolean;
  readonly endTick: number;
}
