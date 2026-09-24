// Сценарный DSL из docs/testing.md: мини-карта в ASCII → состояние матча, команды, прогон по времени.
// Клетка сетки — гекс в offset-координатах (столбец, строка); at(col, row) адресует её так же.
import { ORG_MAX, START_GOLD, TAX_DEFAULT, TICKS_PER_S, type UnitType } from '../../src/balance.ts';
import type { Command, PlayerCommand } from '../../src/commands/types.ts';
import { TERRAIN, type MapStatic } from '../../src/map/types.ts';
import { FP, type Fp } from '../../src/math/int.ts';
import { seedNeutralPopulation } from '../../src/state/create-match.ts';
import { NEUTRAL, type Army, type GameEvent, type MatchState } from '../../src/state/types.ts';
import { step } from '../../src/step.ts';

/** Клетка сетки: столбец и строка. */
export interface At {
  readonly col: number;
  readonly row: number;
}

type Cell =
  | { readonly kind: 'own'; readonly player: string }
  | {
      readonly kind: 'city';
      readonly player: string | null;
      readonly level: number;
      readonly capital: boolean;
    };

type ArmyRef = number | { readonly armyOf: string; readonly index: number };

type DslCommand = {
  readonly t: 'attack';
  readonly armies: readonly ArmyRef[];
  readonly target: At;
};

export const at = (col: number, row: number): At => ({ col, row });

export const own = (player: string): Cell => ({ kind: 'own', player });

export const city = (
  player: string | null,
  level: number,
  opts: { readonly capital?: boolean } = {},
): Cell => ({ kind: 'city', player, level, capital: opts.capital ?? false });

/** Ссылка на армию игрока по порядку создания; разрешается в момент s.cmd. */
export const armyOf = (player: string, index = 0): ArmyRef => ({ armyOf: player, index });

export const attack = (armies: readonly ArmyRef[], target: At): DslCommand => ({
  t: 'attack',
  armies,
  target,
});

const WATER = '~';
const PLAINS = '.';

function parseGrid(ascii: string): string[][] {
  const rows = ascii
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => line.split(/\s+/));
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.some((r) => r.length !== width)) {
    throw new Error('сценарий: строки сетки разной длины или сетка пуста');
  }
  return rows;
}

function playerLetters(grid: string[][], legend: Readonly<Record<string, Cell>>): string[] {
  const letters = new Set<string>();
  for (const token of grid.flat()) {
    const cell = legend[token];
    if (cell?.kind === 'own') letters.add(cell.player);
    if (cell?.kind === 'city' && cell.player !== null) letters.add(cell.player);
  }
  return [...letters].sort();
}

function buildMap(grid: string[][]): MapStatic {
  const width = grid[0]?.length ?? 0;
  const size = width * grid.length;
  const terrain = new Uint8Array(size).fill(TERRAIN.plains);
  grid.flat().forEach((token, id) => {
    if (token === WATER) terrain[id] = TERRAIN.water;
  });
  return {
    version: 1,
    id: 'scenario',
    width,
    height: grid.length,
    terrain,
    features: new Uint8Array(size),
    rivers: new Uint8Array(size),
    roads: new Uint8Array(size),
    cities: [],
    spawns: [],
  };
}

function emptyState(map: MapStatic, players: readonly string[]): MatchState {
  const size = map.width * map.height;
  const state: MatchState = {
    tick: 0,
    seed: 1,
    map,
    hexes: {
      owner: new Int16Array(size).fill(NEUTRAL),
      pop: new Int32Array(size),
      improvement: new Uint8Array(size),
      building: new Uint8Array(size),
      road: new Uint8Array(size),
    },
    cities: [],
    players: players.map((_, id) => ({
      id,
      gold: START_GOLD,
      taxTarget: TAX_DEFAULT,
      taxEffective: TAX_DEFAULT,
      capitalCityId: -1,
      status: 'alive' as const,
    })),
    armies: [],
    nextId: 1,
    events: [],
  };
  seedNeutralPopulation(state);
  return state;
}

export interface Scenario {
  readonly state: MatchState;
  army(player: string, type: UnitType, soldiers: number, where: At): number;
  cmd(player: string, command: DslCommand): void;
  runSeconds(seconds: number): void;
  owner(where: At): string | null;
  armiesOf(player: string): Army[];
  lastEvent(t: GameEvent['t']): GameEvent | undefined;
}

/**
 * Собирает сценарий: '.' — нейтральная равнина, '~' — вода, остальные токены — из легенды.
 * Игроки получают id по алфавиту букв.
 */
export function scenario(
  ascii: string,
  opts: { readonly legend: Readonly<Record<string, Cell>> },
): Scenario {
  const grid = parseGrid(ascii);
  const letters = playerLetters(grid, opts.legend);
  const map = buildMap(grid);
  const state = emptyState(map, letters);
  const idOf = (p: string): number => {
    const id = letters.indexOf(p);
    if (id < 0) throw new Error(`сценарий: неизвестный игрок ${p}`);
    return id;
  };
  grid.flat().forEach((token, hex) => {
    if (token === PLAINS || token === WATER) return;
    const cell = opts.legend[token];
    if (!cell) throw new Error(`сценарий: токен «${token}» нет в легенде`);
    const owner = cell.player === null ? NEUTRAL : idOf(cell.player);
    state.hexes.owner[hex] = owner;
    if (cell.kind !== 'city') return;
    const id = state.nextId;
    state.nextId += 1;
    state.cities.push({ id, hex, owner, level: cell.level, name: token, garrison: 0 as Fp });
    const player = state.players[owner];
    if (cell.capital && player) player.capitalCityId = id;
  });
  return makeScenario(state, idOf, letters);
}

function makeScenario(
  state: MatchState,
  idOf: (p: string) => number,
  letters: readonly string[],
): Scenario {
  const queue: PlayerCommand[] = [];
  const log: GameEvent[] = [];
  const hexOf = (w: At): number => w.col + w.row * state.map.width;
  const armiesOf = (p: string): Army[] => state.armies.filter((a) => a.owner === idOf(p));
  const resolve = (ref: ArmyRef): number => {
    if (typeof ref === 'number') return ref;
    const army = armiesOf(ref.armyOf)[ref.index];
    if (!army) throw new Error(`сценарий: у ${ref.armyOf} нет армии #${ref.index}`);
    return army.id;
  };
  const toCommand = (c: DslCommand): Command => ({
    t: 'attack',
    armyIds: c.armies.map(resolve),
    target: hexOf(c.target),
  });
  return {
    state,
    army(player, type, soldiers, where) {
      const id = state.nextId;
      state.nextId += 1;
      state.armies.push({
        id,
        owner: idOf(player),
        type,
        soldiers: (soldiers * FP) as Fp,
        org: ORG_MAX,
        hex: hexOf(where),
        order: 'idle',
        supplyLevel: FP as Fp,
      });
      return id;
    },
    cmd(player, command) {
      queue.push({ playerId: idOf(player), cmd: toCommand(command) });
    },
    runSeconds(seconds) {
      for (let i = 0; i < seconds * TICKS_PER_S; i += 1) {
        step(state, queue.splice(0));
        log.push(...state.events);
      }
    },
    owner(where) {
      const owner = state.hexes.owner[hexOf(where)] ?? NEUTRAL;
      return owner === NEUTRAL ? null : (letters[owner] ?? null);
    },
    armiesOf,
    lastEvent(t) {
      return [...log].reverse().find((e) => e.t === t);
    },
  };
}
