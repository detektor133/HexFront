// Бенчмарк полного локального матча: симуляция, боты и снимок на каждом тике.
// Запуск: pnpm --filter @hexfront/bench full-match [--players=30,100] [--ticks=15000]
import { performance } from 'node:perf_hooks';

import { createLocalEngine } from '../../../apps/client/src/local/engine.ts';
import { generateMap } from '../../../packages/mapgen/src/index.ts';

const DEFAULT_PLAYERS: readonly number[] = [30, 100];
const DEFAULT_TICKS = 15_000;
const SEED = 43;
const TARGETS_MS = new Map<number, number>([
  [30, 15],
  [100, 40],
]);

interface MatchReport {
  readonly players: number;
  readonly bots: number;
  readonly ticks: number;
  readonly seed: number;
  readonly elapsedMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly targetMeanMs: number;
  readonly budgetExceeded: boolean;
}

interface FullMatchReport {
  readonly node: string;
  readonly map: 'gen';
  readonly scenarios: readonly MatchReport[];
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

function parsePlayers(): readonly number[] {
  const value = process.argv.find((argument) => argument.startsWith('--players='))?.slice(10);
  if (value === undefined || value.length === 0) return DEFAULT_PLAYERS;
  const players = value.split(',').map((item) => Number(item));
  if (players.some((item) => !Number.isInteger(item) || !TARGETS_MS.has(item))) {
    throw new Error('--players должен содержать только 30 и 100');
  }
  return players;
}

function parseTicks(): number {
  const value = process.argv.find((argument) => argument.startsWith('--ticks='))?.slice(8);
  const ticks = value === undefined ? DEFAULT_TICKS : Number(value);
  if (!Number.isInteger(ticks) || ticks < 1)
    throw new Error('--ticks должен быть положительным целым');
  return ticks;
}

function runScenario(players: number, ticks: number): MatchReport {
  const map = generateMap(SEED, { players });
  const bots = Array.from({ length: players }, (_, id) => id);
  const created = createLocalEngine(map, SEED, players, bots, false);
  if ('errors' in created) throw new Error(created.errors.join('\n'));

  const times: number[] = [];
  const started = performance.now();
  for (let tick = 0; tick < ticks; tick += 1) {
    const tickStarted = performance.now();
    created.tick();
    times.push(performance.now() - tickStarted);
  }
  const elapsedMs = performance.now() - started;
  const sorted = [...times].sort((a, b) => a - b);
  const meanMs = times.reduce((sum, time) => sum + time, 0) / times.length;
  const targetMeanMs = TARGETS_MS.get(players);
  if (targetMeanMs === undefined) throw new Error(`нет бюджета для ${players} игроков`);

  return {
    players,
    bots: bots.length,
    ticks,
    seed: SEED,
    elapsedMs: rounded(elapsedMs),
    meanMs: rounded(meanMs),
    p50Ms: rounded(percentile(sorted, 0.5)),
    p95Ms: rounded(percentile(sorted, 0.95)),
    p99Ms: rounded(percentile(sorted, 0.99)),
    maxMs: rounded(sorted.at(-1) ?? 0),
    targetMeanMs,
    budgetExceeded: meanMs > targetMeanMs,
  };
}

const ticks = parseTicks();
const report: FullMatchReport = {
  node: process.version,
  map: 'gen',
  scenarios: parsePlayers().map((players) => runScenario(players, ticks)),
};
console.log(JSON.stringify(report, null, 2));
