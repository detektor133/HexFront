// Бенчмарк пачки тиков локального матча: 30 ботов, gen, seed 43, 4200 тиков.
// Запуск: pnpm --filter @hexfront/bench local
import { performance } from 'node:perf_hooks';

import { createLocalEngine } from '../../../apps/client/src/local/engine.ts';
import { generateMap } from '../../../packages/mapgen/src/index.ts';

const PLAYERS = 30;
const SEED = 43;
const TICKS = 4200;
const BATCH_TICKS = 5;
const TICKS_PER_MINUTE = 600;
const TARGET_MEAN_MS = 15;

interface MinuteStats {
  readonly minute: number;
  readonly ticks: number;
  readonly meanMs: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stats(minute: number, times: readonly number[]): MinuteStats {
  const sorted = [...times].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
  const total = times.reduce((sum, time) => sum + time, 0);
  return {
    minute,
    ticks: times.length,
    meanMs: rounded(total / times.length),
    p99Ms: rounded(p99),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

const map = generateMap(SEED, { width: 80, height: 60, players: PLAYERS });
const bots = Array.from({ length: PLAYERS }, (_, id) => id);
const created = createLocalEngine(map, SEED, PLAYERS, bots, false);
if ('errors' in created) throw new Error(created.errors.join('\n'));

const byMinute: number[][] = [];
for (let tick = 0; tick < TICKS; tick += BATCH_TICKS) {
  const minute = Math.floor(tick / TICKS_PER_MINUTE);
  const started = performance.now();
  for (let i = 1; i < BATCH_TICKS; i += 1) created.advance();
  created.tick();
  const times = byMinute[minute] ?? [];
  times.push((performance.now() - started) / BATCH_TICKS);
  byMinute[minute] = times;
}

const report = byMinute.map((times, minute) => stats(minute + 1, times));
console.log(
  JSON.stringify(
    {
      node: process.version,
      map: 'gen',
      seed: SEED,
      players: PLAYERS,
      bots: bots.length,
      ticks: TICKS,
      batchTicks: BATCH_TICKS,
      minutes: report,
      targetMeanMs: TARGET_MEAN_MS,
      targetReached: report.every((item) => item.meanMs <= TARGET_MEAN_MS),
    },
    null,
    2,
  ),
);
