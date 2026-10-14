import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { type MatchOpponent } from './evaluate.ts';
import type {
  CandidateEvaluation,
  CandidateMatch,
  EvolutionMap,
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
  readonly population: readonly EvolutionWeights[];
  readonly hallOfFame: readonly EvolutionWeights[];
  readonly seeds: readonly number[];
  readonly sigma: number;
  readonly examFitnesses: readonly number[];
  readonly weights?: EvolutionWeights;
  readonly bestExamFitness?: number;
  readonly bestExamWeights?: EvolutionWeights;
}

interface ExamMatch extends CandidateMatch {
  readonly seed: number;
  readonly leaderCities: number;
  readonly neededCities: number;
}

interface GenerationExam {
  readonly fitness: number;
  readonly wins: number;
  readonly matches: readonly ExamMatch[];
}

export interface EvolutionDependencies {
  readonly evaluateExam?: (
    weights: EvolutionWeights,
    ticks: number,
    map: EvolutionMap,
    workers: number,
  ) => GenerationExam | Promise<GenerationExam>;
}

interface CandidateWorkerData {
  readonly kind: 'candidate';
  readonly index: number;
  readonly weights: EvolutionWeights;
  readonly opponents: readonly MatchOpponent[];
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

const ROOT = new URL('../../../', import.meta.url);
const DEFAULT_OPTIONS = {
  ticks: 15_000,
  weightsPath: fileURLToPath(new URL('packages/sim/src/bots/weights.json', ROOT)),
  easyWeightsPath: fileURLToPath(new URL('packages/sim/src/bots/weights-easy.json', ROOT)),
  statePath: fileURLToPath(new URL('tools/evolve/results/resume.json', ROOT)),
  reportDirectory: fileURLToPath(new URL('docs/reports/evolve/', ROOT)),
} as const;

function positiveInteger(value: string, name: string, minimum = 1): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum)
    throw new Error(`${name} должно быть целым числом не меньше ${minimum}`);
  return parsed;
}

function optionValue(arguments_: readonly string[], name: string): string | undefined {
  return arguments_.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

function parseMap(value: string | undefined): EvolutionMap {
  if (value === undefined || value === 'small' || value === 'gen') return value ?? 'small';
  throw new Error('map должен быть small или gen');
}

export function parseOptions(arguments_: readonly string[]): EvolutionOptions {
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
  const workers = positiveInteger(
    optionValue(arguments_, '--workers') ?? String(Math.max(1, availableParallelism() - 1)),
    'workers',
  );
  const ticks = positiveInteger(
    optionValue(arguments_, '--ticks') ?? String(DEFAULT_OPTIONS.ticks),
    'ticks',
  );
  const sigma = positiveInteger(optionValue(arguments_, '--sigma') ?? '100', 'sigma');
  const resumeArgument = arguments_.find((argument) => argument === '--resume');
  const resumePath =
    optionValue(arguments_, '--resume') ??
    (resumeArgument === undefined ? undefined : DEFAULT_OPTIONS.statePath);
  return {
    population,
    seeds,
    generations,
    workers,
    ticks,
    map: parseMap(optionValue(arguments_, '--map')),
    sigma,
    weightsPath: optionValue(arguments_, '--weights') ?? DEFAULT_OPTIONS.weightsPath,
    easyWeightsPath: optionValue(arguments_, '--easy-weights') ?? DEFAULT_OPTIONS.easyWeightsPath,
    statePath: optionValue(arguments_, '--state') ?? DEFAULT_OPTIONS.statePath,
    reportDirectory: optionValue(arguments_, '--report-dir') ?? DEFAULT_OPTIONS.reportDirectory,
    ...(resumePath === undefined ? {} : { resumePath }),
    ...(optionValue(arguments_, '--easy-generation') === undefined
      ? {}
      : {
          easyGeneration: positiveInteger(
            optionValue(arguments_, '--easy-generation') ?? '1',
            'easy-generation',
          ),
        }),
  };
}

function copyWeights(weights: Readonly<Record<string, number>>): EvolutionWeights {
  return Object.fromEntries(
    Object.entries(weights).map(([name, value]) => [name, Math.trunc(value)]),
  );
}

function mutateWeights(parent: EvolutionWeights, seed: number, sigma: number): EvolutionWeights {
  const rng = fork(seed, 0x6576_6f6c);
  return Object.fromEntries(
    Object.entries(parent).map(([name, value]) => [
      name,
      Math.max(-1000, Math.min(1000, value + nextRange(rng, -sigma, sigma))),
    ]),
  );
}

function initialPopulation(
  weights: EvolutionWeights,
  population: number,
  sigma: number,
): Candidate[] {
  return Array.from({ length: population }, (_, index) => ({
    index,
    weights: index === 0 ? copyWeights(weights) : mutateWeights(weights, index, sigma),
  }));
}

function seedsFor(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function examSeeds(): number[] {
  return [101, 102, 103, 104, 105, 106];
}

export function examCandidateSlotForSeed(seed: number): number {
  return examSeeds().indexOf(seed);
}

export function evaluateExam(
  weights: EvolutionWeights,
  ticks: number,
  map: EvolutionMap = 'small',
  workers = Math.max(1, availableParallelism() - 1),
): Promise<GenerationExam> {
  const jobs = examSeeds();
  const matches: ExamMatch[] = [];
  let nextIndex = 0;
  const runNext = async (): Promise<void> => {
    const index = nextIndex;
    nextIndex += 1;
    const seed = jobs[index];
    if (seed === undefined) return;
    matches.push(await evaluateExamWorker(weights, seed, ticks, map));
    await runNext();
  };
  return Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, runNext)).then(() => {
    matches.sort((left, right) => left.seed - right.seed);
    return {
      fitness: matches.reduce((sum, match) => sum + match.fitness, 0),
      wins: matches.filter((match) => match.won).length,
      matches,
    };
  });
}

function evaluateExamWorker(
  weights: EvolutionWeights,
  seed: number,
  ticks: number,
  map: EvolutionMap,
): Promise<ExamMatch> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { kind: 'exam', weights, seed, ticks, map } satisfies ExamWorkerData,
      execArgv: [...process.execArgv, '--experimental-strip-types'],
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker завершился с кодом ${code}`));
    });
  });
}

export function shouldStopForNoExamProgress(examFitnesses: readonly number[]): boolean {
  const baseline = examFitnesses[1];
  if (baseline === undefined || examFitnesses.length < 6) return false;
  return examFitnesses.slice(2, 6).every((fitness) => fitness <= baseline);
}

export function createMatchup(
  hallOfFame: readonly EvolutionWeights[],
  fallbackWeights: EvolutionWeights,
): { opponents: MatchOpponent[]; candidateSlot: number } {
  const selected = hallOfFame.slice(0, 5);
  while (selected.length < 5) selected.push(fallbackWeights);
  return {
    candidateSlot: 0,
    opponents: selected.map((weights, index) => ({ weights, slot: index + 1 })),
  };
}

function evaluateCandidate(
  candidate: Candidate,
  data: Omit<CandidateWorkerData, 'index' | 'weights'>,
): Promise<{ index: number; seed: number; match: CandidateMatch }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: {
        ...data,
        kind: 'candidate',
        index: candidate.index,
        weights: candidate.weights,
      } satisfies CandidateWorkerData,
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
  hallOfFame: readonly EvolutionWeights[],
  fallbackWeights: EvolutionWeights,
  options: EvolutionOptions,
): Promise<readonly CandidateEvaluation[]> {
  const jobs: Array<{
    candidate: Candidate;
    data: Omit<CandidateWorkerData, 'index' | 'weights'>;
  }> = [];
  const match = createMatchup(hallOfFame, fallbackWeights);
  for (const candidate of population) {
    for (const seed of seedsFor(options.seeds)) {
      jobs.push({
        candidate,
        data: {
          kind: 'candidate',
          opponents: match.opponents,
          candidateSlot: match.candidateSlot,
          seed,
          ticks: options.ticks,
          map: options.map ?? 'small',
        },
      });
    }
  }
  const results: Array<{ index: number; seed: number; match: CandidateMatch }> = [];
  let nextIndex = 0;
  const runNext = async (): Promise<void> => {
    const index = nextIndex;
    nextIndex += 1;
    const job = jobs[index];
    if (job === undefined) return;
    results.push(await evaluateCandidate(job.candidate, job.data));
    await runNext();
  };
  await Promise.all(Array.from({ length: Math.min(options.workers, population.length) }, runNext));
  const grouped = new Map<number, typeof results>();
  for (const result of results) {
    const group = grouped.get(result.index) ?? [];
    group.push(result);
    grouped.set(result.index, group);
  }
  return population.map((candidate) => {
    const matches = (grouped.get(candidate.index) ?? [])
      .sort((left, right) => left.seed - right.seed)
      .map((result) => result.match);
    return {
      index: candidate.index,
      fitness: matches.reduce((sum, match) => sum + match.fitness, 0),
      maxGoldOver5000S: Math.max(...matches.map((match) => match.goldOver5000S), 0),
      maxUnitUnder10S: Math.max(...matches.map((match) => match.unitUnder10S), 0),
      endTick: Math.max(...matches.map((match) => match.endTick), 0),
      matches,
    };
  });
}

async function loadResume(path: string): Promise<ResumeState> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('generation' in parsed) ||
    !('population' in parsed) ||
    !('hallOfFame' in parsed)
  )
    throw new Error('resume имеет неверный формат');
  const state = parsed as ResumeState;
  return {
    generation: state.generation,
    population: state.population,
    hallOfFame: state.hallOfFame,
    seeds: state.seeds,
    sigma: state.sigma,
    examFitnesses: state.examFitnesses ?? [],
    ...(state.bestExamFitness === undefined ? {} : { bestExamFitness: state.bestExamFitness }),
    ...(state.bestExamWeights === undefined ? {} : { bestExamWeights: state.bestExamWeights }),
  };
}

async function writeGeneration(
  generation: number,
  result: EvolutionResult,
  easyWeights: EvolutionWeights,
  population: readonly Candidate[],
  hallOfFame: readonly EvolutionWeights[],
  options: EvolutionOptions,
  durationMs: number,
  exam: GenerationExam,
  examFitnesses: readonly number[],
  bestExamWeights: EvolutionWeights,
  bestExamFitness: number,
): Promise<void> {
  await mkdir(options.reportDirectory, { recursive: true });
  await mkdir(dirname(options.weightsPath), { recursive: true });
  await mkdir(dirname(options.statePath), { recursive: true });
  await writeFile(options.weightsPath, `${JSON.stringify(bestExamWeights, null, 2)}\n`, 'utf8');
  await writeFile(
    options.easyWeightsPath ?? join(dirname(options.weightsPath), 'weights-easy.json'),
    `${JSON.stringify(easyWeights, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    options.statePath,
    `${JSON.stringify({ generation, weights: result.weights, bestExamWeights, bestExamFitness, population: population.map((item) => item.weights), hallOfFame, seeds: seedsFor(options.seeds), sigma: options.sigma ?? 100, examFitnesses }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    `${options.reportDirectory}/generation-${generation}.md`,
    [
      `# Эволюция весов, поколение ${generation}`,
      '',
      `Поколение: ${generation}`,
      `Лучший fitness: ${result.fitness}`,
      `Средний fitness: ${result.averageFitness ?? 0}`,
      `Золото > 5 000 с: ${result.metrics?.maxGoldOver5000S ?? 0}`,
      `Отряд < 10 с: ${result.metrics?.maxUnitUnder10S ?? 0}`,
      `Тик завершения: ${result.metrics?.endTick ?? options.ticks}`,
      `Места лучшей особи: ${(result.metrics?.places ?? []).join(', ')}`,
      `Победы лучшей особи: ${result.metrics?.wins ?? 0}`,
      `Победы популяции: ${result.metrics?.populationWins ?? 0}`,
      `Среднее место популяции: ${result.metrics?.averagePlace ?? 0}`,
      `Время поколения: ${durationMs} мс`,
      '',
      `Экзамен: fitness ${exam.fitness}, победы ${exam.wins}`,
      ...exam.matches.map(
        (match) =>
          `Экзамен, сид ${match.seed}: fitness ${match.fitness}, победа ${match.won ? 'да' : 'нет'}, тик ${match.endTick}, города лидера ${match.leaderCities}/${match.neededCities}, золото > 5 000 с ${match.goldOver5000S}, отряд < 10 с ${match.unitUnder10S}`,
      ),
      '',
      '```json',
      JSON.stringify(result.weights, null, 2),
      '```',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function writeExamReport(
  generation: number,
  weights: EvolutionWeights,
  exam: GenerationExam,
  options: EvolutionOptions,
): Promise<void> {
  await mkdir(options.reportDirectory, { recursive: true });
  await writeFile(
    `${options.reportDirectory}/generation-${generation}.md`,
    [
      `# Экзамен весов, поколение ${generation}`,
      '',
      `Поколение: ${generation}`,
      `Экзамен: fitness ${exam.fitness}, победы ${exam.wins}`,
      ...exam.matches.map(
        (match) =>
          `Экзамен, сид ${match.seed}: fitness ${match.fitness}, победа ${match.won ? 'да' : 'нет'}, тик ${match.endTick}, города лидера ${match.leaderCities}/${match.neededCities}, золото > 5 000 с ${match.goldOver5000S}, отряд < 10 с ${match.unitUnder10S}`,
      ),
      '',
      '```json',
      JSON.stringify(weights, null, 2),
      '```',
      '',
    ].join('\n'),
    'utf8',
  );
}

export async function runEvolution(
  options: EvolutionOptions,
  dependencies: EvolutionDependencies = {},
): Promise<EvolutionResult> {
  const examEvaluator = dependencies.evaluateExam ?? evaluateExam;
  const resume = options.resumePath === undefined ? null : await loadResume(options.resumePath);
  const evolutionOptions = resume
    ? { ...options, seeds: resume.seeds.length, sigma: resume.sigma }
    : options;
  const startGeneration = resume?.generation ?? 0;
  let population = resume
    ? resume.population.map((weights, index) => ({ index, weights: copyWeights(weights) }))
    : initialPopulation(
        copyWeights(baseWeights as Record<string, number>),
        evolutionOptions.population,
        evolutionOptions.sigma ?? 100,
      );
  let hallOfFame = resume?.hallOfFame.map(copyWeights) ?? [];
  let result: EvolutionResult = {
    generation: startGeneration,
    fitness: 0,
    weights: copyWeights(population[0]?.weights ?? {}),
  };
  let easyWeights = copyWeights(result.weights);
  const examFitnesses = [...(resume?.examFitnesses ?? [])];
  let bestExamFitness = resume?.bestExamFitness ?? Number.NEGATIVE_INFINITY;
  let bestExamWeights = copyWeights(resume?.bestExamWeights ?? result.weights);
  const easyGeneration =
    evolutionOptions.easyGeneration ?? Math.max(1, Math.floor(evolutionOptions.generations / 3));
  if (startGeneration === 0) {
    const initialExam = await examEvaluator(
      result.weights,
      evolutionOptions.ticks,
      evolutionOptions.map ?? 'small',
      evolutionOptions.workers,
    );
    examFitnesses.push(initialExam.fitness);
    if (initialExam.fitness > bestExamFitness) {
      bestExamFitness = initialExam.fitness;
      bestExamWeights = copyWeights(result.weights);
    }
    await writeExamReport(startGeneration, result.weights, initialExam, evolutionOptions);
  }
  for (let generation = 1; generation <= options.generations; generation += 1) {
    const started = Date.now();
    const evaluations = await evaluatePopulation(
      population,
      hallOfFame,
      copyWeights(baseWeights as Record<string, number>),
      evolutionOptions,
    );
    const ranked = [...evaluations].sort(
      (left, right) => right.fitness - left.fitness || left.index - right.index,
    );
    const best = ranked[0];
    if (best === undefined) throw new Error('пустая популяция');
    const bestCandidate = population[best.index];
    if (bestCandidate === undefined) throw new Error(`нет кандидата ${best.index}`);
    const populationWins = evaluations.reduce(
      (sum, item) => sum + item.matches.filter((match) => match.won).length,
      0,
    );
    const populationPlaces = evaluations.flatMap((item) =>
      item.matches.map((match) => match.place),
    );
    const bestMatches = best.matches;
    hallOfFame = [copyWeights(bestCandidate.weights), ...hallOfFame];
    result = {
      generation: startGeneration + generation,
      fitness: best.fitness,
      averageFitness: Math.trunc(
        evaluations.reduce((sum, item) => sum + item.fitness, 0) / evaluations.length,
      ),
      weights: copyWeights(bestCandidate.weights),
      metrics: {
        maxGoldOver5000S: best.maxGoldOver5000S ?? 0,
        maxUnitUnder10S: best.maxUnitUnder10S ?? 0,
        endTick: best.endTick ?? evolutionOptions.ticks,
        places: bestMatches.map((match) => match.place),
        wins: bestMatches.filter((match) => match.won).length,
        populationWins,
        averagePlace:
          populationPlaces.length === 0
            ? 0
            : populationPlaces.reduce((sum, place) => sum + place, 0) / populationPlaces.length,
      },
    };
    if (generation === easyGeneration) easyWeights = copyWeights(result.weights);
    const exam = await examEvaluator(
      result.weights,
      evolutionOptions.ticks,
      evolutionOptions.map ?? 'small',
      evolutionOptions.workers,
    );
    examFitnesses.push(exam.fitness);
    if (exam.fitness > bestExamFitness) {
      bestExamFitness = exam.fitness;
      bestExamWeights = copyWeights(result.weights);
    }
    const parentCount = Math.max(1, Math.floor(population.length / 2));
    const nextPopulation = Array.from({ length: population.length }, (_, index) => {
      const parent = population[ranked[index % parentCount]?.index ?? best.index];
      return {
        index,
        weights:
          index === 0
            ? copyWeights(bestCandidate.weights)
            : mutateWeights(
                parent?.weights ?? bestCandidate.weights,
                result.generation * 100_000 + index,
                evolutionOptions.sigma ?? 100,
              ),
      };
    });
    await writeGeneration(
      result.generation,
      result,
      easyWeights,
      nextPopulation,
      hallOfFame,
      evolutionOptions,
      Date.now() - started,
      exam,
      examFitnesses,
      bestExamWeights,
      bestExamFitness,
    );
    if (result.generation === 5 && shouldStopForNoExamProgress(examFitnesses)) {
      throw new Error('нет прогресса по экзамену');
    }
    population = nextPopulation;
  }
  return result;
}

if (process.argv[1]?.match(/[\\/]src[\\/]index\.ts$/)) {
  const result = await runEvolution(
    parseOptions(process.argv.slice(2).filter((argument) => argument !== '--')),
  );
  console.log(JSON.stringify(result, null, 2));
}
