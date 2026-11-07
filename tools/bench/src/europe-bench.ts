// Нагрузка большой карты: матч ботов на Европе, время тика (sim + боты) и снимка игроку по минутам.
// Запуск: pnpm --filter @hexfront/bench europe [-- --players=10 --minutes=25 --seed=7]
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createLocalEngine } from '../../../apps/client/src/local/engine.ts';
import { encodeSnapshot } from '../../../packages/protocol/src/index.ts';

const arg = (name: string, fallback: number): number => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? Number(found.slice(name.length + 3)) : fallback;
};
const players = arg('players', 10);
const minutes = arg('minutes', 25);
const seed = arg('seed', 7);
const map: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/europe.json', import.meta.url), 'utf8'),
);
const bots = Array.from({ length: players }, (_, i) => i);
const engine = createLocalEngine(map, seed, players, bots, true, '', true);
if ('errors' in engine) throw new Error(engine.errors.join('; '));

const TICKS_PER_MINUTE = 600;
const rows: unknown[] = [];
let stepMs: number[] = [];
let snapMs: number[] = [];
let encMs: number[] = [];
const pct = (a: number[], q: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return Math.round((s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0) * 100) / 100;
};
for (let tick = 1; tick <= minutes * TICKS_PER_MINUTE; tick += 1) {
  let t0 = performance.now();
  engine.advance();
  stepMs.push(performance.now() - t0);
  t0 = performance.now();
  const snap = engine.snapshot();
  snapMs.push(performance.now() - t0);
  t0 = performance.now();
  JSON.stringify(encodeSnapshot(snap.snapshot));
  encMs.push(performance.now() - t0);
  if (tick % TICKS_PER_MINUTE === 0) {
    rows.push({
      minute: tick / TICKS_PER_MINUTE,
      units: engine.state.units.length,
      stepP50: pct(stepMs, 0.5),
      stepP99: pct(stepMs, 0.99),
      stepMax: pct(stepMs, 1),
      viewP50: pct(snapMs, 0.5),
      encodeP50: pct(encMs, 0.5),
    });
    stepMs = [];
    snapMs = [];
    encMs = [];
  }
}
console.log(JSON.stringify(rows, null, 1));
