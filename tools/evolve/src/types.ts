export type EvolutionWeights = Record<string, number>;

export interface EvolutionOptions {
  readonly population: number;
  readonly seeds: number;
  readonly generations: number;
  readonly workers: number;
  readonly sigma?: number;
  readonly easyGeneration?: number;
  readonly ticks: number;
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
  };
}

export interface CandidateEvaluation {
  readonly index: number;
  readonly fitness: number;
  readonly maxGoldOver5000S?: number;
  readonly maxUnitUnder10S?: number;
  readonly endTick?: number;
}
