import { mkdir, writeFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';

export interface BalanceMatchOptions {
  readonly matches: number;
  readonly seeds: readonly number[];
  readonly parallelism: number;
  readonly players: number;
  readonly ticks: number;
  readonly revision: string;
}

export interface BalanceReportOptions {
  readonly matches: number;
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

export interface BalanceTimelinePoint {
  readonly tick: number;
  readonly populationMean: number;
  readonly goldMean: number;
}

export interface BalanceStartPositionResult {
  readonly playerId: number;
  readonly startPosition: number;
  readonly finalPlace: number;
}

export interface BalanceMetrics {
  readonly durationTicks: number;
  readonly neutralHexShareAt3Min: {
    readonly tick: number;
    readonly neutralHexes: number;
    readonly totalHexes: number;
  } | null;
  readonly firstBattleMinute: number | null;
  readonly cauldrons: number;
  readonly placesByStartPosition: readonly BalanceStartPositionResult[];
  readonly timeline: readonly BalanceTimelinePoint[];
}

export interface BalanceMatchResult {
  readonly runIndex: number;
  readonly seed: number;
  readonly ticks: number;
  readonly revision: string;
  readonly map: BalanceMapResult;
  readonly metrics: BalanceMetrics;
}

interface WorkerMessage extends BalanceMatchResult {
  readonly ok: true;
}

type CliOptions = BalanceMatchOptions;

const CSV_COLUMNS = [
  'runIndex',
  'seed',
  'revision',
  'players',
  'mapId',
  'mapWidth',
  'mapHeight',
  'durationTicks',
  'neutralHexShareAt3MinTick',
  'neutralHexesAt3Min',
  'totalHexesAt3Min',
  'firstBattleMinute',
  'cauldrons',
  'populationTimeline',
  'goldTimeline',
  'placesByStartPosition',
] as const;

function csvCell(value: number | string | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function jsonCell(value: unknown): string {
  return csvCell(JSON.stringify(value));
}

function reportRow(result: BalanceMatchResult): readonly (number | string | null)[] {
  const neutral = result.metrics.neutralHexShareAt3Min;
  return [
    result.runIndex,
    result.seed,
    result.revision,
    result.map.players,
    result.map.id,
    result.map.width,
    result.map.height,
    result.metrics.durationTicks,
    neutral?.tick ?? null,
    neutral?.neutralHexes ?? null,
    neutral?.totalHexes ?? null,
    result.metrics.firstBattleMinute,
    result.metrics.cauldrons,
    jsonCell(
      result.metrics.timeline.map(({ tick, populationMean }) => ({ tick, mean: populationMean })),
    ),
    jsonCell(result.metrics.timeline.map(({ tick, goldMean }) => ({ tick, mean: goldMean }))),
    jsonCell(result.metrics.placesByStartPosition),
  ];
}

export function formatBalanceCsv(
  results: readonly BalanceMatchResult[],
  _options: BalanceReportOptions,
): string {
  const rows = results.map((result) => reportRow(result));
  return [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => row.map((value) => csvCell(value)).join(',')),
    '',
  ].join('\n');
}

export function formatBalanceMarkdown(
  results: readonly BalanceMatchResult[],
  options: BalanceReportOptions,
): string {
  const rows = results.map((result) => {
    const neutral = result.metrics.neutralHexShareAt3Min;
    const neutralShare = neutral === null ? '—' : `${neutral.neutralHexes}/${neutral.totalHexes}`;
    return `| ${result.runIndex} | ${result.seed} | ${result.revision} | ${result.map.id} (${result.map.width}×${result.map.height}) | ${result.metrics.durationTicks} | ${neutralShare} | ${result.metrics.firstBattleMinute ?? '—'} | ${result.metrics.cauldrons} | ${result.metrics.timeline.length} | ${result.metrics.placesByStartPosition.length} |`;
  });
  return [
    '# Отчёт балансировочного прогона',
    '',
    `Параметры: матчей — ${options.matches}; параллельность — ${options.parallelism}; игроков — ${options.players}; тиков — ${options.ticks}; ревизия — ${options.revision}.`,
    '',
    '| Запуск | Сид | Ревизия | Карта | Длительность, тики | Нейтральные гексы на 3:00 | Первый бой, минута | Котлы | Точек временного ряда | Стартовых позиций |',
    '| ---: | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
  ].join('\n');
}

export async function writeBalanceReports(
  results: readonly BalanceMatchResult[],
  options: BalanceReportOptions,
  directory: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(`${directory}/balance-report.md`, formatBalanceMarkdown(results, options), 'utf8'),
    writeFile(`${directory}/balance-report.csv`, formatBalanceCsv(results, options), 'utf8'),
  ]);
}

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
        metrics: message.metrics,
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
  const results = await runBalanceMatches(options);
  const reportDirectory =
    process.argv
      .slice(2)
      .find((argument) => argument.startsWith('--report-dir='))
      ?.slice('--report-dir='.length) ?? 'tools/balance/results';
  await writeBalanceReports(results, options, reportDirectory);
  console.log(`Отчёты записаны в ${reportDirectory}`);
}
