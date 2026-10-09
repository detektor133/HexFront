export type EvolutionWeights = Record<string, number>;

export interface EvolutionOptions {
  readonly population: number;
  readonly seeds: number;
  readonly generations: number;
  readonly workers: number;
  readonly ticks: number;
  readonly weightsPath: string;
  readonly statePath: string;
  readonly reportDirectory: string;
  readonly resumePath?: string;
}

export interface EvolutionResult {
  readonly generation: number;
  readonly fitness: number;
  readonly weights: EvolutionWeights;
}

export interface CandidateEvaluation {
  readonly index: number;
  readonly fitness: number;
}
