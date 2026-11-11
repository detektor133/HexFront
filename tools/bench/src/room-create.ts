// Из чего складывается создание комнаты: генерация карты, загрузка, createMatch, первый тик.
//
// Запуск (из корня репозитория):
//   node --experimental-strip-types tools/bench/src/room-create.ts
import { generateMap, QUICK_MATCH_MAP_SIZE } from '../../../packages/mapgen/src/index.ts';
import { QUICK_MATCH_SEEDS } from '../../../packages/protocol/src/index.ts';
import { createMatch, loadMap, step } from '../../../packages/sim/src/index.ts';

const lap = <T>(label: string, run: () => T, results: Record<string, number[]>): T => {
  const started = performance.now();
  const value = run();
  (results[label] ??= []).push(performance.now() - started);
  return value;
};

const results: Record<string, number[]> = {};
for (const seed of QUICK_MATCH_SEEDS.slice(0, 8)) {
  const json = lap(
    'generateMap',
    () => generateMap(seed, { ...QUICK_MATCH_MAP_SIZE, players: 30 }),
    results,
  );
  const loaded = lap('loadMap', () => loadMap(json), results);
  if (!loaded.ok) throw new Error('map');
  const state = lap(
    'createMatch',
    () =>
      createMatch(
        loaded.map,
        Array.from({ length: 30 }, (_, i) => ({ name: `P${i}` })),
        seed,
        { fog: true, diplomacy: true },
      ),
    results,
  );
  lap('первый step', () => step(state, []), results);
}
for (const [label, values] of Object.entries(results)) {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(
    `${label.padEnd(12)} медиана ${sorted[Math.floor(sorted.length / 2)]?.toFixed(1)} мс, макс ${sorted.at(-1)?.toFixed(1)} мс`,
  );
}
