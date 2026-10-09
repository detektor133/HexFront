import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type {
  CandidateEvaluation,
  EvolutionOptions,
  EvolutionResult,
  EvolutionWeights,
} from './types.ts';
import baseWeights from '../../../packages/sim/src/bots/weights.json' with { type: 'json' };
import { fork, nextRange } from '../../../packages/sim/src/rng.ts';

export type { EvolutionOptions, EvolutionResult, EvolutionWeights } from './types.ts';

interface Candidate {
  readonly index: number;
  readonly weights: EvolutionWeights;
}

interface ResumeState {
  readonly generation: number;
  readonly weights: EvolutionWeights;
}

interface WorkerData {
  readonly index: number;
  readonly weights: EvolutionWeights;
  readonly seeds: readonly number[];
  readonly ticks: number;
}

const ROOT = new URL('../../../', import.meta.url);
const DEFAULT_OPTIONS = {
  ticks: 300,
  weightsPath: fileURLToPath(new URL('packages/sim/src/bots/weights.json', ROOT)),
  statePath: fileURLToPath(new URL('tools/evolve/results/resume.json', ROOT)),
  reportDirectory: fileURLToPath(new URL('docs/reports/evolve/', ROOT)),
} as const;

function positiveInteger(value: string, name: string, minimum = 1): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} должно быть целым числом не меньше ${minimum}`);
  }
  return parsed;
}

function optionValue(arguments_: readonly string[], name: string): string | undefined {
  return arguments_.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function parseOptions(arguments_: readonly string[]): EvolutionOptions {
  const resumeArgument = arguments_.find((argument) => argument === '--resume');
  if (resumeArgument !== undefined) throw new Error('resume должен иметь путь: --resume=...');
  const population = positiveInteger(
    optionValue(arguments_, '--population') ?? '12',
    'population',
    2,
  );
  const seeds = positiveInteger(optionValue(arguments_, '--seeds') ?? '6', 'seeds');
  const generations = positiveInteger(
    optionValue(arguments_, '--generations') ?? '30',
    'generations',
  );
  const workers = positiveInteger(optionValue(arguments_, '--workers') ?? '1', 'workers');
  const ticks = positiveInteger(
    optionValue(arguments_, '--ticks') ?? String(DEFAULT_OPTIONS.ticks),
    'ticks',
  );
  const resumePath = optionValue(arguments_, '--resume');
  return {
    population,
    seeds,
    generations,
    workers,
    ticks,
    weightsPath: optionValue(arguments_, '--weights') ?? DEFAULT_OPTIONS.weightsPath,
    statePath: optionValue(arguments_, '--state') ?? DEFAULT_OPTIONS.statePath,
    reportDirectory: optionValue(arguments_, '--report-dir') ?? DEFAULT_OPTIONS.reportDirectory,
    ...(resumePath === undefined ? {} : { resumePath }),
  };
}

function copyWeights(weights: Readonly<Record<string, number>>): EvolutionWeights {
  return Object.fromEntries(
    Object.entries(weights).map(([name, value]) => [name, Math.trunc(value)]),
  );
}

function mutateWeights(parent: EvolutionWeights, seed: number): EvolutionWeights {
  const rng = fork(seed, 0x6576_6f6c);
  return Object.fromEntries(
    Object.entries(parent).map(([name, value]) => [name, value + nextRange(rng, -20, 20)]),
  );
}

function initialPopulation(weights: EvolutionWeights, population: number): Candidate[] {
  return Array.from({ length: population }, (_, index) => ({
    index,
    weights: index === 0 ? copyWeights(weights) : mutateWeights(weights, index),
  }));
}

function offspring(
  parents: readonly Candidate[],
  population: number,
  generation: number,
): Candidate[] {
  return Array.from({ length: population }, (_, index) => {
    const parent = parents[index % parents.length];
    if (parent === undefined) throw new Error('нет родителей для потомков');
    return {
      index,
      weights: mutateWeights(parent.weights, generation * 100_000 + index + 1),
    };
  });
}

function seedsFor(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function evaluateCandidate(
  candidate: Candidate,
  seeds: readonly number[],
  ticks: number,
): Promise<CandidateEvaluation> {
  return new Promise((resolve, reject) => {
    const data: WorkerData = { index: candidate.index, weights: candidate.weights, seeds, ticks };
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: data,
      execArgv: [...process.execArgv, '--experimental-strip-types'],
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker завершился с кодом ${code}`));
    });
  });
}

async function evaluatePopulation(
  population: readonly Candidate[],
  options: EvolutionOptions,
): Promise<readonly CandidateEvaluation[]> {
  const results: CandidateEvaluation[] = [];
  let nextIndex = 0;
  const runNext = async (): Promise<void> => {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= population.length) return;
    const candidate = population[index];
    if (candidate === undefined) throw new Error(`нет кандидата ${index}`);
    results.push(await evaluateCandidate(candidate, seedsFor(options.seeds), options.ticks));
    await runNext();
  };
  await Promise.all(Array.from({ length: Math.min(options.workers, population.length) }, runNext));
  return results.sort((left, right) => left.index - right.index);
}

async function loadResume(path: string): Promise<ResumeState> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('generation' in parsed) ||
    !('weights' in parsed) ||
    typeof parsed.generation !== 'number' ||
    typeof parsed.weights !== 'object' ||
    parsed.weights === null
  ) {
    throw new Error('resume имеет неверный формат');
  }
  return {
    generation: parsed.generation,
    weights: copyWeights(parsed.weights as Record<string, number>),
  };
}

async function writeGeneration(
  generation: number,
  result: EvolutionResult,
  options: EvolutionOptions,
): Promise<void> {
  await mkdir(options.reportDirectory, { recursive: true });
  await mkdir(dirname(options.weightsPath), { recursive: true });
  await mkdir(dirname(options.statePath), { recursive: true });
  await writeFile(options.weightsPath, `${JSON.stringify(result.weights, null, 2)}\n`, 'utf8');
  await writeFile(
    options.statePath,
    `${JSON.stringify({ generation, weights: result.weights }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    `${options.reportDirectory}/generation-${generation}.md`,
    [
      `# Эволюция весов, поколение ${generation}`,
      '',
      `Поколение: ${generation}`,
      `Fitness: ${result.fitness}`,
      `Размер популяции: ${options.population}`,
      `Сиды: ${options.seeds}`,
      `Тиков оценки: ${options.ticks}`,
      '',
      '```json',
      JSON.stringify(result.weights, null, 2),
      '```',
      '',
    ].join('\n'),
    'utf8',
  );
}

export async function runEvolution(options: EvolutionOptions): Promise<EvolutionResult> {
  const resume = options.resumePath === undefined ? null : await loadResume(options.resumePath);
  const startGeneration = resume?.generation ?? 0;
  let population = initialPopulation(
    resume?.weights ?? copyWeights(baseWeights as Record<string, number>),
    options.population,
  );
  let result: EvolutionResult = {
    generation: startGeneration,
    fitness: 0,
    weights: copyWeights(population[0]?.weights ?? {}),
  };
  for (let generation = 1; generation <= options.generations; generation += 1) {
    const evaluations = await evaluatePopulation(population, options);
    const ranked = [...evaluations].sort(
      (left, right) => right.fitness - left.fitness || left.index - right.index,
    );
    const best = ranked[0];
    if (best === undefined) throw new Error('пустая популяция');
    const bestCandidate = population[best.index];
    if (bestCandidate === undefined) throw new Error(`нет кандидата ${best.index}`);
    result = {
      generation: startGeneration + generation,
      fitness: best.fitness,
      weights: copyWeights(bestCandidate.weights),
    };
    await writeGeneration(result.generation, result, options);
    const parentCount = Math.max(1, Math.floor(options.population / 2));
    population = offspring(
      ranked
        .slice(0, parentCount)
        .map((evaluation) => population[evaluation.index])
        .filter((candidate): candidate is Candidate => candidate !== undefined),
      options.population,
      result.generation,
    );
  }
  return result;
}

if (process.argv[1]?.match(/[\\/]src[\\/]index\.ts$/)) {
  const result = await runEvolution(
    parseOptions(process.argv.slice(2).filter((argument) => argument !== '--')),
  );
  console.log(JSON.stringify(result, null, 2));
}
