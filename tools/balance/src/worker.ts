import { parentPort, workerData } from 'node:worker_threads';

import type { BalanceMetrics, BalanceStartPositionResult, BalanceTimelinePoint } from './index.ts';
import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  fork,
  hexId,
  loadMap,
  playerPlaces,
  playerScores,
  RNG_STREAM,
  shuffle,
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
const startHexes = shuffle(
  fork(data.seed, RNG_STREAM.spawns),
  loaded.map.spawns.map((spawn) => hexId(spawn, loaded.map.width)),
);
const timeline: BalanceTimelinePoint[] = [];
const encircledUnits = new Set<number>();
let firstBattleMinute: number | null = null;
let neutralHexShareAt3Min: BalanceMetrics['neutralHexShareAt3Min'] = null;

function meanPopulation(): number {
  const total = state.hexes.pop.reduce(
    (sum, population, hex) => sum + (state.hexes.owner[hex] !== -1 ? population : 0),
    0,
  );
  return Math.trunc(total / state.players.length);
}

function meanGold(): number {
  return Math.trunc(
    state.players.reduce((sum, player) => sum + player.gold, 0) / state.players.length,
  );
}

function recordMetrics(): void {
  if (firstBattleMinute === null && state.units.some((unit) => unit.inBattle)) {
    firstBattleMinute = Math.ceil(state.tick / 600);
  }
  for (const unit of state.units) if (unit.encircled) encircledUnits.add(unit.id);
  if (state.tick % 600 === 0) {
    timeline.push({ tick: state.tick, populationMean: meanPopulation(), goldMean: meanGold() });
  }
  if (state.tick === 1800) {
    const neutralHexes = state.hexes.owner.reduce((sum, owner) => sum + (owner === -1 ? 1 : 0), 0);
    neutralHexShareAt3Min = {
      tick: state.tick,
      neutralHexes,
      totalHexes: state.hexes.owner.length,
    };
  }
}

for (let tick = 0; tick < data.ticks; tick += 1) {
  const context = createBotTickContext(state);
  step(state, [...commanderCommands(state, bots, context), ...botCommands(state, bots, context)]);
  recordMetrics();
}
const scores = playerScores(state);
const places = playerPlaces(state, scores);
const placesByStartPosition: BalanceStartPositionResult[] = state.players.map((player) => {
  const capital = state.cities.find((city) => city.id === player.capitalCityId);
  return {
    playerId: player.id,
    startPosition: Math.max(0, startHexes.indexOf(capital?.hex ?? -1)),
    finalPlace: places[player.id] ?? 0,
  };
});
const metrics: BalanceMetrics = {
  durationTicks: state.tick,
  neutralHexShareAt3Min,
  firstBattleMinute,
  cauldrons: encircledUnits.size,
  placesByStartPosition,
  timeline,
};
parentPort?.postMessage({
  ok: true,
  runIndex: data.runIndex,
  seed: data.seed,
  ticks: state.tick,
  revision: data.revision,
  metrics,
  map: {
    id: loaded.map.id,
    players: data.players,
    width: loaded.map.width,
    height: loaded.map.height,
  },
});
