// Полный матч ботов (04/T24) без клиента: все игроки — боты (экономический мозг + commander), карта
// small, до победы. Те же команды и тот же порядок, что у локального движка клиента в режиме
// наблюдения, — матч совпадает с записью песочницы с тем же сидом.
// Запуск: pnpm --filter @hexfront/replay bot-match [игроков] [сид] [out.json]
import { readFileSync, writeFileSync } from 'node:fs';

import { generateMap } from '../../../packages/mapgen/src/index.ts';
import {
  botCommands,
  commanderCommands,
  createBotTickContext,
  createMatch,
  FP,
  isCityIsolated,
  loadMap,
  step,
  TICKS_PER_S,
  type MatchState,
} from '../../../packages/sim/src/index.ts';

const root = new URL('../../../', import.meta.url);
const PLAYERS = Number(process.argv[2] ?? 6);
const SEED = Number(process.argv[3] ?? 42);
const OUT = process.argv[4] ?? null;
const MAP_KIND = process.argv[5] ?? 'small';
const SAMPLE_EVERY_S = 10;
const FRAME_EVERY_S = 60;
/** Предохранитель: таймер матча — 25:00, дальше победа по очкам; с запасом. */
const MAX_TICKS = 30 * 60 * TICKS_PER_S;

/** Срез игрока во времени. */
export interface PlayerSample {
  readonly soldiers: number;
  readonly units: number;
  readonly gold: number;
  readonly hexes: number;
  readonly cities: number;
  readonly alive: boolean;
}

function sample(state: MatchState): PlayerSample[] {
  return state.players.map((p) => ({
    soldiers: Math.round(
      state.units.filter((u) => u.owner === p.id).reduce((s, u) => s + u.soldiers, 0) / FP,
    ),
    units: state.units.filter((u) => u.owner === p.id).length,
    gold: Math.round(p.gold / FP),
    hexes: state.hexes.owner.filter((o) => o === p.id).length,
    cities: state.cities.filter((c) => c.owner === p.id).length,
    alive: p.status === 'alive',
  }));
}

if (MAP_KIND !== 'small' && MAP_KIND !== 'gen') throw new Error(`неизвестная карта: ${MAP_KIND}`);
const mapJson =
  MAP_KIND === 'gen'
    ? generateMap(SEED, { width: 80, height: 60, players: PLAYERS })
    : JSON.parse(readFileSync(new URL('packages/mapgen/maps/small.json', root), 'utf8'));
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const state = createMatch(
  loaded.map,
  Array.from({ length: PLAYERS }, (_, i) => ({ name: `P${i}` })),
  SEED,
);
const bots = state.players.map((p) => p.id);
const samples: { t: number; players: PlayerSample[] }[] = [];
const frames: { t: number; owner: number[] }[] = [];
const commands = new Map<string, number>();
const rejected = new Map<string, number>();
const events = new Map<string, number>();
const count = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
const roadLog: { t: number; playerId: number; cityId: number; reason: string }[] = [];
const knownRoads = new Set<number>();
const roadCause = new Map<number, string>();
const goldTicks = state.players.map(() => 0);
let maxGoldTicks = 0;
const smallTicks = new Map<number, number>();
let maxSmallTicks = 0;
let centralNeutralAt10 = 1;
let firstEliminationS: number | null = null;
let winReason: string | null = null;

function unitsAt25Minutes(): { maxSize: number; averageSize: number } {
  if (state.tick < 25 * 60 * TICKS_PER_S) return { maxSize: 0, averageSize: 0 };
  const sizes = state.units.map((unit) => unit.soldiers / FP);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return {
    maxSize: Math.max(0, ...sizes),
    averageSize: sizes.length === 0 ? 0 : total / sizes.length,
  };
}

function centralNeutralRatio(): number {
  const { width, height, terrain } = state.map;
  let passable = 0;
  let neutral = 0;
  for (let row = Math.floor(height / 3); row < Math.ceil((2 * height) / 3); row += 1) {
    for (let col = Math.floor(width / 3); col < Math.ceil((2 * width) / 3); col += 1) {
      const hex = col + row * width;
      if (terrain[hex] === 0) continue;
      passable += 1;
      if (state.hexes.owner[hex] === -1) neutral += 1;
    }
  }
  return passable === 0 ? 0 : neutral / passable;
}

function updateDurations(): void {
  state.players.forEach((p, i) => {
    goldTicks[i] = p.gold > 5000 * FP ? (goldTicks[i] ?? 0) + 1 : 0;
    maxGoldTicks = Math.max(maxGoldTicks, goldTicks[i] ?? 0);
  });
  const current = new Set<number>();
  for (const unit of state.units) {
    current.add(unit.id);
    const ticks = unit.soldiers < 10 * FP ? (smallTicks.get(unit.id) ?? 0) + 1 : 0;
    smallTicks.set(unit.id, ticks);
    maxSmallTicks = Math.max(maxSmallTicks, ticks);
  }
  for (const id of smallTicks.keys()) if (!current.has(id)) smallTicks.delete(id);
}

const started = Date.now();
while (state.winner < 0 && state.tick < MAX_TICKS) {
  if (state.tick % (SAMPLE_EVERY_S * TICKS_PER_S) === 0) {
    samples.push({ t: state.tick / TICKS_PER_S, players: sample(state) });
  }
  if (state.tick % (FRAME_EVERY_S * TICKS_PER_S) === 0)
    frames.push({ t: state.tick / TICKS_PER_S, owner: [...state.hexes.owner] });
  const isolation = new Map(state.cities.map((city) => [city.id, isCityIsolated(state, city.id)]));
  const context = createBotTickContext(state);
  const cmds = [...commanderCommands(state, bots, context), ...botCommands(state, bots, context)];
  for (const c of cmds) count(commands, `${c.source ?? 'bot'}:${c.cmd.t}`);
  step(state, cmds);
  updateDurations();
  if (state.tick === 10 * 60 * TICKS_PER_S) centralNeutralAt10 = centralNeutralRatio();
  const captured = new Set<number>();
  const moved = new Set<number>();
  const founded = new Set<number>();
  for (const e of state.events) {
    if (e.t === 'commandRejected')
      count(rejected, `${e.auto ? 'auto' : 'bot'}:${e.command}:${e.reason}`);
    else count(events, e.t);
    if (e.t === 'playerEliminated' && firstEliminationS === null) {
      firstEliminationS = state.tick / TICKS_PER_S;
    }
    if (e.t === 'matchWon') winReason = e.reason;
    if (e.t === 'cityCaptured') captured.add(e.cityId);
    if (e.t === 'capitalMoved') moved.add(e.playerId);
    if (e.t === 'constructionDone' && e.kind === 'foundCity') founded.add(e.hex);
  }
  for (const city of state.cities) {
    if (isCityIsolated(state, city.id) && isolation.get(city.id) === false) {
      roadCause.set(
        city.id,
        captured.has(city.id)
          ? 'cityCaptured'
          : moved.has(city.owner)
            ? 'capitalMoved'
            : 'territoryLost',
      );
    }
  }
  for (const road of state.constructions.filter((c) => c.kind === 'road')) {
    if (knownRoads.has(road.id)) continue;
    knownRoads.add(road.id);
    const city = state.cities.find((c) => c.hex === road.hex);
    roadLog.push({
      t: state.tick / TICKS_PER_S,
      playerId: road.owner,
      cityId: city?.id ?? -1,
      reason: founded.has(road.hex)
        ? 'newCity'
        : (roadCause.get(city?.id ?? -1) ?? 'initialIsolation'),
    });
  }
}
samples.push({ t: state.tick / TICKS_PER_S, players: sample(state) });
if (frames.at(-1)?.t !== state.tick / TICKS_PER_S)
  frames.push({ t: state.tick / TICKS_PER_S, owner: [...state.hexes.owner] });

const result = {
  players: PLAYERS,
  seed: SEED,
  map: MAP_KIND,
  winner: state.winner,
  endS: state.tick / TICKS_PER_S,
  wallS: (Date.now() - started) / 1000,
  commands: Object.fromEntries([...commands].sort()),
  rejected: Object.fromEntries([...rejected].sort((a, b) => b[1] - a[1])),
  events: Object.fromEntries([...events].sort()),
  acceptance: {
    firstEliminationS,
    winReason,
    maxGoldOver5000S: maxGoldTicks / TICKS_PER_S,
    maxUnitUnder10S: maxSmallTicks / TICKS_PER_S,
    centralNeutralAt10,
    ...(() => {
      const units = unitsAt25Minutes();
      return {
        maxUnitSizeAt25: units.maxSize,
        averageSoldiersPerUnitAt25: units.averageSize,
      };
    })(),
  },
  roadLog,
  final: {
    width: state.map.width,
    height: state.map.height,
    terrain: [...state.map.terrain],
    owner: [...state.hexes.owner],
    cities: state.cities.map((city) => ({
      hex: city.hex,
      owner: city.owner,
      capital: state.players[city.owner]?.capitalCityId === city.id,
    })),
  },
  frames,
  samples,
};
if (OUT) writeFileSync(OUT, JSON.stringify(result));
console.log(JSON.stringify({ ...result, samples: samples.length }, null, 2));
