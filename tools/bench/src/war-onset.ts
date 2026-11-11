// Профиль начала войны: время тиков вокруг конца «мирного» периода ботов и самые тяжёлые функции.
//
// Запуск (из корня репозитория):
//   node --experimental-strip-types tools/bench/src/war-onset.ts [--seed=43] [--from=3000] [--ticks=120]
import { Session } from 'node:inspector';

import { generateMap, QUICK_MATCH_MAP_SIZE } from '../../../packages/mapgen/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  loadMap,
  step,
} from '../../../packages/sim/src/index.ts';

const option = (name: string, fallback: string): string => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SEED = Number(option('seed', '43'));
const FROM = Number(option('from', '3000'));
const TICKS = Number(option('ticks', '120'));

const loaded = loadMap(generateMap(SEED, { ...QUICK_MATCH_MAP_SIZE, players: 30 }));
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const state = createMatch(
  loaded.map,
  Array.from({ length: 30 }, (_, i) => ({ name: `P${i}` })),
  SEED,
  { fog: true, diplomacy: true },
);
const bots = Array.from({ length: 27 }, (_, i) => i + 3);
const levels = state.players.map(() => 'medium' as const);

const tick = (): { bots: number; step: number } => {
  const started = performance.now();
  const context = createBotTickContext(state);
  const commands = [
    ...commanderCommands(state, bots, levels, context),
    ...botCommands(state, bots, levels, context),
  ];
  const decided = performance.now();
  step(state, commands);
  return { bots: decided - started, step: performance.now() - decided };
};

for (let i = 0; i < FROM; i += 1) tick();

const session = new Session();
session.connect();
const post = <T>(method: string, params?: object): Promise<T> =>
  new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => {
      if (error) reject(error);
      else resolve(result as T);
    });
  });
await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: 200 });
await post('Profiler.start');

const rows: { bots: number; step: number }[] = [];
for (let i = 0; i < TICKS; i += 1) rows.push(tick());

const { profile } = await post<{
  profile: {
    nodes: {
      id: number;
      callFrame: { functionName: string; url: string; lineNumber: number };
      hitCount: number;
    }[];
    samples: number[];
    timeDeltas: number[];
  };
}>('Profiler.stop');

const self = new Map<number, number>();
profile.samples.forEach((id, index) => {
  self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0));
});
const byName = new Map<string, number>();
for (const node of profile.nodes) {
  const name = `${node.callFrame.functionName || '(анонимная)'} ${node.callFrame.url.split('/').slice(-2).join('/')}:${node.callFrame.lineNumber + 1}`;
  byName.set(name, (byName.get(name) ?? 0) + (self.get(node.id) ?? 0));
}
const total = [...byName.values()].reduce((a, b) => a + b, 0);

const total_ms = rows.map((r) => r.bots + r.step);
const sorted = [...total_ms].sort((a, b) => a - b);
console.log(
  `тики ${FROM}–${FROM + TICKS}: медиана ${sorted[Math.floor(sorted.length / 2)]?.toFixed(1)} мс, p95 ${sorted[Math.floor(sorted.length * 0.95)]?.toFixed(1)}, макс ${sorted.at(-1)?.toFixed(1)} мс; ` +
    `боты ${(rows.reduce((s, r) => s + r.bots, 0) / rows.length).toFixed(1)} мс, шаг ${(rows.reduce((s, r) => s + r.step, 0) / rows.length).toFixed(1)} мс в среднем`,
);
for (const [name, time] of [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`${((time / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
}
