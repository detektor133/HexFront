// Бенчмарк автокомандования (04/T21, CR-006): синтетический матч step-bench — 30 игроков,
// 4000 гексов, 200 отрядов, у всех армий auto. Commander вызывается вне step, поэтому его время
// меряется отдельно от бюджета step: сколько занимает commanderCommands за тик.
// Запуск: pnpm --filter @hexfront/bench commander
import { performance } from 'node:perf_hooks';

import { syntheticMatch } from '../../../packages/sim/bench/synthetic.ts';
import { commanderCommands, step } from '../../../packages/sim/src/index.ts';

const TICKS = 600;
/** Первые тики — пересчёт снабжения и сетей всеми игроками, в замер не входят. */
const WARMUP = 10;

const { state } = syntheticMatch();
for (const a of state.armies) a.auto = true;
for (let i = 0; i < WARMUP; i += 1) step(state, commanderCommands(state));

const commander: number[] = [];
const steps: number[] = [];
let commands = 0;
for (let i = 0; i < TICKS; i += 1) {
  const t0 = performance.now();
  const cmds = commanderCommands(state);
  const t1 = performance.now();
  step(state, cmds);
  steps.push(performance.now() - t1);
  commander.push(t1 - t0);
  commands += cmds.length;
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (x: number): number => Math.round(x * 1000) / 1000;
  return {
    meanMs: r(s.reduce((a, b) => a + b, 0) / s.length),
    p99Ms: r(q(0.99)),
    maxMs: r(q(1)),
  };
};

console.log(
  JSON.stringify(
    {
      node: process.version,
      ticks: TICKS,
      players: state.players.length,
      armies: state.armies.length,
      units: state.units.length,
      commandsPerTick: Math.round((commands / TICKS) * 10) / 10,
      commander: stats(commander),
      step: stats(steps),
    },
    null,
    2,
  ),
);
