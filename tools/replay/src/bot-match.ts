// Полный матч ботов (04/T24) без клиента: все игроки — боты (экономический мозг + commander), карта
// small, до победы. Те же команды и тот же порядок, что у локального движка клиента в режиме
// наблюдения, — матч совпадает с записью песочницы с тем же сидом.
// Запуск: pnpm --filter @hexfront/replay bot-match [игроков] [сид] [out.json]
import { readFileSync, writeFileSync } from 'node:fs';

import {
  botCommands,
  commanderCommands,
  createMatch,
  FP,
  loadMap,
  step,
  TICKS_PER_S,
  type MatchState,
} from '../../../packages/sim/src/index.ts';

const root = new URL('../../../', import.meta.url);
const PLAYERS = Number(process.argv[2] ?? 6);
const SEED = Number(process.argv[3] ?? 42);
const OUT = process.argv[4] ?? null;
const SAMPLE_EVERY_S = 10;
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

const loaded = loadMap(
  JSON.parse(readFileSync(new URL('packages/mapgen/maps/small.json', root), 'utf8')),
);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const state = createMatch(
  loaded.map,
  Array.from({ length: PLAYERS }, (_, i) => ({ name: `P${i}` })),
  SEED,
);
const bots = state.players.map((p) => p.id);
const samples: { t: number; players: PlayerSample[] }[] = [];
const commands = new Map<string, number>();
const rejected = new Map<string, number>();
const events = new Map<string, number>();
const count = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);

const started = Date.now();
while (state.winner < 0 && state.tick < MAX_TICKS) {
  if (state.tick % (SAMPLE_EVERY_S * TICKS_PER_S) === 0) {
    samples.push({ t: state.tick / TICKS_PER_S, players: sample(state) });
  }
  const cmds = [...commanderCommands(state), ...botCommands(state, bots)];
  for (const c of cmds) count(commands, `${c.source ?? 'bot'}:${c.cmd.t}`);
  step(state, cmds);
  for (const e of state.events) {
    if (e.t === 'commandRejected')
      count(rejected, `${e.auto ? 'auto' : 'bot'}:${e.command}:${e.reason}`);
    else count(events, e.t);
  }
}
samples.push({ t: state.tick / TICKS_PER_S, players: sample(state) });

const result = {
  players: PLAYERS,
  seed: SEED,
  winner: state.winner,
  endS: state.tick / TICKS_PER_S,
  wallS: (Date.now() - started) / 1000,
  commands: Object.fromEntries([...commands].sort()),
  rejected: Object.fromEntries([...rejected].sort((a, b) => b[1] - a[1])),
  events: Object.fromEntries([...events].sort()),
  samples,
};
if (OUT) writeFileSync(OUT, JSON.stringify(result));
console.log(JSON.stringify({ ...result, samples: samples.length }, null, 2));
