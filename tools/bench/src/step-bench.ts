// Бенчмарк step (03/T11): синтетический матч из packages/sim/bench — 30 игроков, 4000 гексов,
// 200 отрядов, 20 боёв. Цель (sim-core.md): ≤ 3 мс в среднем, ≤ 10 мс p99 на одном ядре.
// Запуск: pnpm --filter @hexfront/bench step
import { performance } from 'node:perf_hooks';

import { rearm, syntheticMatch } from '../../../packages/sim/bench/synthetic.ts';
import { step } from '../../../packages/sim/src/index.ts';

/** Серии по 150 тиков со свежего матча: бои живут 6–20 с, и 20 боёв идут почти весь замер. */
const SERIES = 20;
const SERIES_STEPS = 150;
/** Первые тики серии — пересчёт снабжения и сетей всеми игроками, в замер не входят. */
const WARMUP_STEPS = 10;
const MEASURED_STEPS = SERIES * SERIES_STEPS;
const TARGET_MEAN_MS = 3;
const TARGET_P99_MS = 10;

const times: number[] = [];
let fighting = 0;
let battles = 0;
let last = syntheticMatch();
for (let series = 0; series < SERIES; series += 1) {
  last = syntheticMatch();
  const { state, fronts } = last;
  for (let i = 0; i < WARMUP_STEPS; i += 1) step(state, rearm(state, fronts));
  for (let i = 0; i < SERIES_STEPS; i += 1) {
    const cmds = rearm(state, fronts);
    const t0 = performance.now();
    step(state, cmds);
    times.push(performance.now() - t0);
    fighting += state.units.filter((u) => u.inBattle).length;
    battles += new Set(state.units.filter((u) => u.order === 'attack').map((u) => u.target)).size;
  }
}
const { state } = last;

times.sort((a, b) => a - b);
const at = (q: number): number =>
  times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
const mean = times.reduce((s, t) => s + t, 0) / times.length;
const report = {
  node: process.version,
  steps: MEASURED_STEPS,
  hexes: state.map.width * state.map.height,
  players: state.players.length,
  units: state.units.length,
  unitsInBattleAvg: Math.round((fighting / MEASURED_STEPS) * 10) / 10,
  battlesAvg: Math.round((battles / MEASURED_STEPS) * 10) / 10,
  meanMs: Math.round(mean * 1000) / 1000,
  p50Ms: Math.round(at(0.5) * 1000) / 1000,
  p99Ms: Math.round(at(0.99) * 1000) / 1000,
  maxMs: Math.round(at(1) * 1000) / 1000,
};
console.log(JSON.stringify(report, null, 2));
const ok = report.meanMs <= TARGET_MEAN_MS && report.p99Ms <= TARGET_P99_MS;
console.log(
  ok
    ? 'цель достигнута'
    : `цель НЕ достигнута: ≤ ${TARGET_MEAN_MS} мс среднее, ≤ ${TARGET_P99_MS} мс p99`,
);
