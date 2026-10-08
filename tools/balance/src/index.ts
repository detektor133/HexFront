import { Worker } from 'node:worker_threads';

export interface BalanceMatchOptions {
  readonly matches: number;
  readonly seeds: readonly number[];
  readonly parallelism: number;
  readonly players: number;
  readonly ticks: number;
  readonly revision: string;
}

export interface BalanceMapResult {
  readonly id: string;
  readonly players: number;
  readonly width: number;
  readonly height: number;
}

export interface BalanceMatchResult {
  readonly runIndex: number;
  readonly seed: number;
  readonly ticks: number;
  readonly revision: string;
  readonly map: BalanceMapResult;
}

interface WorkerMessage extends BalanceMatchResult {
  readonly ok: true;
}

type CliOptions = BalanceMatchOptions;

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} должно быть положительным целым`);
  return parsed;
}

function parseSeeds(value: string): readonly number[] {
  const seeds = value.split(',').map((item) => Number(item));
  if (seeds.some((seed) => !Number.isSafeInteger(seed)))
    throw new Error('seed должны быть целыми числами');
  return seeds;
}

export function parseOptions(arguments_: readonly string[]): CliOptions {
  const value = (name: string): string | undefined =>
    arguments_.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  const matches = positiveInteger(value('--matches') ?? '1', 'число матчей');
  const parallelism = positiveInteger(value('--parallelism') ?? '1', 'параллельность');
  const players = positiveInteger(value('--players') ?? '30', 'число игроков');
  if (players !== 30) throw new Error('стенд балансировки поддерживает только 30 игроков');
  const ticks =
    value('--ticks') === undefined ? 600 : positiveInteger(value('--ticks') ?? '0', 'число тиков');
  const seeds =
    value('--seeds') === undefined
      ? Array.from({ length: matches }, (_, index) => index)
      : parseSeeds(value('--seeds') ?? '');
  if (seeds.length !== matches) throw new Error('число сидов должно совпадать с числом матчей');
  return {
    matches,
    seeds,
    parallelism,
    players,
    ticks,
    revision: value('--revision') ?? 'working-tree',
  };
}

function runWorker(runIndex: number, options: BalanceMatchOptions): Promise<BalanceMatchResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: {
        runIndex,
        seed: options.seeds[runIndex],
        players: options.players,
        ticks: options.ticks,
        revision: options.revision,
      },
    });
    worker.once('message', (message: WorkerMessage) => {
      resolve({
        runIndex: message.runIndex,
        seed: message.seed,
        ticks: message.ticks,
        revision: message.revision,
        map: message.map,
      });
      void worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker завершился с кодом ${code}`));
    });
  });
}

export async function runBalanceMatches(
  options: BalanceMatchOptions,
): Promise<readonly BalanceMatchResult[]> {
  if (options.seeds.length !== options.matches)
    throw new Error('число сидов должно совпадать с числом матчей');
  if (options.players !== 30) throw new Error('стенд балансировки поддерживает только 30 игроков');
  const results: BalanceMatchResult[] = [];
  let nextIndex = 0;
  const runNext = async (): Promise<void> => {
    const runIndex = nextIndex;
    nextIndex += 1;
    if (runIndex >= options.matches) return;
    results.push(await runWorker(runIndex, options));
    await runNext();
  };
  const workers = Math.min(options.parallelism, options.matches);
  await Promise.all(Array.from({ length: workers }, () => runNext()));
  return results.sort((left, right) => left.runIndex - right.runIndex);
}

if (process.argv[1]?.match(/[\\/]src[\\/]index\.ts$/)) {
  const options = parseOptions(process.argv.slice(2).filter((argument) => argument !== '--'));
  console.log(JSON.stringify(await runBalanceMatches(options), null, 2));
}
