import { parentPort, workerData } from 'node:worker_threads';

import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  loadMap,
  step,
} from '../../../packages/sim/src/index.ts';

interface WorkerData {
  readonly runIndex: number;
  readonly seed: number;
  readonly players: number;
  readonly ticks: number;
  readonly revision: string;
}

const data = workerData as WorkerData;
const loaded = loadMap(generateMap(data.seed, { players: data.players }));
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const bots = Array.from({ length: data.players }, (_, id) => id);
const state = createMatch(
  loaded.map,
  bots.map((id) => ({ name: `P${id}` })),
  data.seed,
  { fog: false },
);
for (let tick = 0; tick < data.ticks; tick += 1) {
  const context = createBotTickContext(state);
  step(state, [...commanderCommands(state, bots, context), ...botCommands(state, bots, context)]);
}
parentPort?.postMessage({
  ok: true,
  runIndex: data.runIndex,
  seed: data.seed,
  ticks: state.tick,
  revision: data.revision,
  map: {
    id: loaded.map.id,
    players: data.players,
    width: loaded.map.width,
    height: loaded.map.height,
  },
});
