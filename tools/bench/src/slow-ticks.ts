// Редкие медленные тики: какие функции едят время именно в них.
// Симуляция детерминирована, поэтому матч прогоняется дважды: первый проход находит медленные тики,
// второй включает профиль процессора только на них и складывает результат по функциям.
//
// Запуск (из корня репозитория):
//   node --experimental-strip-types tools/bench/src/slow-ticks.ts [--seed=43 --to=9000 --over=25]
import { Session } from 'node:inspector';

import { generateMap, QUICK_MATCH_MAP_SIZE } from '../../../packages/mapgen/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  loadMap,
  step,
  type MatchState,
} from '../../../packages/sim/src/index.ts';

const option = (name: string, fallback: string): string => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SEED = Number(option('seed', '43'));
const TO = Number(option('to', '9000'));
const OVER_MS = Number(option('over', '25'));

function fresh(): { state: MatchState; tick: () => number } {
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
  return {
    state,
    tick: () => {
      const started = performance.now();
      const context = createBotTickContext(state);
      const commands = [
        ...commanderCommands(state, bots, levels, context),
        ...botCommands(state, bots, levels, context),
      ];
      step(state, commands);
      return performance.now() - started;
    },
  };
}

// Проход 1: длительность каждого тика.
const first = fresh();
const slow: { tick: number; ms: number }[] = [];
for (let i = 0; i < TO; i += 1) {
  const ms = first.tick();
  if (ms > OVER_MS) slow.push({ tick: i, ms });
}
console.log(
  `медленных тиков (> ${OVER_MS} мс) из ${TO}: ${slow.length}; ` +
    `самые тяжёлые: ${slow
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 8)
      .map((s) => `${s.tick} (${s.ms.toFixed(0)} мс)`)
      .join(', ')}`,
);

// Проход 2: профиль только на медленных тиках.
const session = new Session();
session.connect();
const post = <T>(method: string, params?: object): Promise<T> =>
  new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => (error ? reject(error) : resolve(result as T)));
  });
await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: 100 });
interface Node {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}
const slowSet = new Set(slow.map((s) => s.tick));
const second = fresh();
const byName = new Map<string, number>();
for (let i = 0; i < TO; i += 1) {
  if (!slowSet.has(i)) {
    second.tick();
    continue;
  }
  await post('Profiler.start');
  second.tick();
  const { profile } = await post<{
    profile: { nodes: Node[]; samples: number[]; timeDeltas: number[] };
  }>('Profiler.stop');
  const nameOf = new Map(
    profile.nodes.map((n) => [
      n.id,
      `${n.callFrame.functionName || '(анонимная)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`,
    ]),
  );
  profile.samples.forEach((id, index) => {
    const name = nameOf.get(id) ?? '?';
    byName.set(name, (byName.get(name) ?? 0) + (profile.timeDeltas[index] ?? 0));
  });
}
const total = [...byName.values()].reduce((a, b) => a + b, 0);
for (const [name, time] of [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`${((time / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
}
