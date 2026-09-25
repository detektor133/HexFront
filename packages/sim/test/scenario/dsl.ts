// Сценарный DSL из docs/testing.md: мини-карта в ASCII → состояние матча, команды, прогон по времени.
// Клетка сетки — гекс в offset-координатах (столбец, строка); at(col, row) адресует её так же.
import {
  MILITIA_PER_LEVEL,
  NEUTRAL_GARRISON,
  ORG_MAX,
  START_GOLD,
  TAX_DEFAULT,
  TICKS_PER_S,
  type UnitType,
} from '../../src/balance.ts';
import type { Command, PlayerCommand } from '../../src/commands/types.ts';
import { TERRAIN, type MapStatic, type TerrainName } from '../../src/map/types.ts';
import { hexId, inBounds, neighbors, offsetToAxial } from '../../src/math/hex.ts';
import { FP, type Fp } from '../../src/math/int.ts';
import { captureHex } from '../../src/state/capture.ts';
import { seedNeutralPopulation } from '../../src/state/create-match.ts';
import { recomputeAllNetworks } from '../../src/state/network.ts';
import {
  BUILDING,
  NEUTRAL,
  type Army,
  type Unit,
  type City,
  type GameEvent,
  type MatchState,
  type Player,
} from '../../src/state/types.ts';
import { step } from '../../src/step.ts';

/** Клетка сетки: столбец и строка. */
export interface At {
  readonly col: number;
  readonly row: number;
}

type Cell =
  | {
      readonly kind: 'own';
      readonly player: string;
      readonly terrain: TerrainName;
      readonly road?: boolean;
    }
  | {
      readonly kind: 'city';
      readonly player: string | null;
      readonly level: number;
      readonly capital: boolean;
    };

type UnitRef = number | { readonly unitOf: string; readonly index: number };

type DslCommand =
  | { readonly t: 'attack'; readonly units: readonly UnitRef[]; readonly target: At }
  | { readonly t: 'move'; readonly units: readonly UnitRef[]; readonly to: At }
  | {
      readonly t: 'setOrder';
      readonly units: readonly UnitRef[];
      readonly order: 'idle' | 'hold' | 'expand';
    }
  | { readonly t: 'split'; readonly unit: UnitRef; readonly soldiers: number }
  | { readonly t: 'merge'; readonly units: readonly UnitRef[] }
  | { readonly t: 'bombard'; readonly unit: UnitRef; readonly targetUnitId: number | null }
  | { readonly t: 'createArmy'; readonly name: string }
  | { readonly t: 'renameArmy'; readonly armyId: number; readonly name: string }
  | { readonly t: 'disbandArmy'; readonly armyId: number }
  | {
      readonly t: 'assignUnits';
      readonly units: readonly UnitRef[];
      readonly armyId: number | null;
    }
  | { readonly t: 'setAutoReinforce'; readonly on: boolean }
  | {
      readonly t: 'assignFront';
      readonly armyId: number;
      readonly enemy: string;
      readonly section: readonly [At, At] | null;
    }
  | { readonly t: 'setDefenseLine'; readonly armyId: number; readonly points: readonly At[] }
  | { readonly t: 'clearPlan'; readonly armyId: number }
  | {
      readonly t: 'armyOrder';
      readonly armyId: number;
      readonly order: 'idle' | 'hold' | 'expand';
    }
  | { readonly t: 'setTax'; readonly percent: number }
  | { readonly t: 'foundCity' | 'improve' | 'upgradeCity' | 'rebuildSupply'; readonly where: At }
  | { readonly t: 'build'; readonly where: At; readonly kind: 'fort' | 'depot' }
  | {
      readonly t: 'recruit';
      readonly where: At;
      readonly type: UnitType;
      readonly soldiers: number;
    };

export const at = (col: number, row: number): At => ({ col, row });

/** Свой гекс с дорогой (равнина). */
export const road = (player: string): Cell => ({
  kind: 'own',
  player,
  terrain: 'plains',
  road: true,
});

/** Свой гекс; местность по умолчанию — равнина. */
export const own = (player: string, terrain: TerrainName = 'plains'): Cell => ({
  kind: 'own',
  player,
  terrain,
});

export const city = (
  player: string | null,
  level: number,
  opts: { readonly capital?: boolean } = {},
): Cell => ({ kind: 'city', player, level, capital: opts.capital ?? false });

/** Ссылка на отряд игрока по порядку создания; разрешается в момент s.cmd. */
export const unitOf = (player: string, index = 0): UnitRef => ({ unitOf: player, index });

export const attack = (units: readonly UnitRef[], target: At): DslCommand => ({
  t: 'attack',
  units,
  target,
});

export const move = (units: readonly UnitRef[], to: At): DslCommand => ({ t: 'move', units, to });
export const setOrder = (
  units: readonly UnitRef[],
  order: 'idle' | 'hold' | 'expand',
): DslCommand => ({ t: 'setOrder', units, order });
/** Отделить soldiers целых солдат в новый отряд. */
export const split = (unit: UnitRef, soldiers: number): DslCommand => ({
  t: 'split',
  unit,
  soldiers,
});
export const merge = (units: readonly UnitRef[]): DslCommand => ({ t: 'merge', units });

/** Фокус огня артиллерии; null — автоцель. */
export const bombard = (unit: UnitRef, targetUnitId: number | null): DslCommand => ({
  t: 'bombard',
  unit,
  targetUnitId,
});
export const createArmy = (name: string): DslCommand => ({ t: 'createArmy', name });
export const renameArmy = (armyId: number, name: string): DslCommand => ({
  t: 'renameArmy',
  armyId,
  name,
});
export const disbandArmy = (armyId: number): DslCommand => ({ t: 'disbandArmy', armyId });
/** Назначить отряды в армию; null — вернуть в резерв. */
export const assignUnits = (units: readonly UnitRef[], armyId: number | null): DslCommand => ({
  t: 'assignUnits',
  units,
  armyId,
});
export const armyOrder = (armyId: number, order: 'idle' | 'hold' | 'expand'): DslCommand => ({
  t: 'armyOrder',
  armyId,
  order,
});

/** Армия на фронт против игрока enemy (буква), вся граница или участок между двумя гексами. */
export const assignFront = (
  armyId: number,
  enemy: string,
  section: readonly [At, At] | null,
): DslCommand => ({ t: 'assignFront', armyId, enemy, section });
/** Линия обороны армии по точкам. */
export const setDefenseLine = (armyId: number, points: readonly At[]): DslCommand => ({
  t: 'setDefenseLine',
  armyId,
  points,
});
export const clearPlan = (armyId: number): DslCommand => ({ t: 'clearPlan', armyId });
export const setAutoReinforce = (on: boolean): DslCommand => ({ t: 'setAutoReinforce', on });

export const foundCity = (where: At): DslCommand => ({ t: 'foundCity', where });
export const improve = (where: At): DslCommand => ({ t: 'improve', where });
/** Улучшение города, стоящего в клетке where. */
export const upgradeCity = (where: At): DslCommand => ({ t: 'upgradeCity', where });
/** Перестройка снабжения города, стоящего в клетке where. */
export const rebuildSupply = (where: At): DslCommand => ({ t: 'rebuildSupply', where });
export const build = (where: At, kind: 'fort' | 'depot'): DslCommand => ({
  t: 'build',
  where,
  kind,
});

/** Набор в городе, стоящем в клетке where; soldiers — целые солдаты. */
export const recruit = (where: At, type: UnitType, soldiers: number): DslCommand => ({
  t: 'recruit',
  where,
  type,
  soldiers,
});

/** Налог в процентах, как на ползунке HUD (может быть и невалидным — для тестов отказа). */
export const setTax = (percent: number): DslCommand => ({ t: 'setTax', percent });

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

function buildMap(grid: string[][], legend: Readonly<Record<string, Cell>>): MapStatic {
  const width = grid[0]?.length ?? 0;
  const size = width * grid.length;
  const terrain = new Uint8Array(size).fill(TERRAIN.plains);
  grid.flat().forEach((token, id) => {
    if (token === WATER) terrain[id] = TERRAIN.water;
    const cell = legend[token];
    if (cell?.kind === 'own') terrain[id] = TERRAIN[cell.terrain];
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
      network: new Int32Array(size).fill(-1),
    },
    cities: [],
    players: players.map((_, id) => ({
      id,
      gold: START_GOLD,
      taxTarget: TAX_DEFAULT,
      taxEffective: TAX_DEFAULT,
      capitalCityId: -1,
      status: 'alive' as const,
      citiesFounded: 0,
      bankrupt: false,
      armiesCreated: 0,
      autoReinforce: false,
      chaosTicks: 0,
      noCityTicks: 0,
      eliminatedTick: -1,
    })),
    units: [],
    constructions: [],
    recruits: [],
    armies: [],
    plans: [],
    networks: [],
    nextId: 1,
    events: [],
    winner: -1,
    holdPlayer: -1,
    holdTicks: 0,
  };
  seedNeutralPopulation(state);
  return state;
}

export interface Scenario {
  readonly state: MatchState;
  unit(player: string, type: UnitType, soldiers: number, where: At): number;
  cmd(player: string, command: DslCommand): void;
  /** Прогон целых секунд; дробные — через runTicks (float-умножение даёт лишний тик). */
  runSeconds(seconds: number): void;
  runTicks(ticks: number): void;
  owner(where: At): string | null;
  unitsOf(player: string): Unit[];
  lastEvent(t: GameEvent['t']): GameEvent | undefined;
  /** Население гекса, fixed-point. */
  pop(where: At): number;
  /** Задать население гекса в людях. */
  setPop(where: At, people: number): void;
  player(p: string): Player;
  /** Город в клетке или undefined. */
  cityAt(where: At): City | undefined;
  /**
   * Сменить владельца гекса в обход команд — для тестов разреза сетей и потери городов;
   * город на гексе переходит вместе с ним. null — нейтральный.
   */
  setOwner(where: At, player: string | null): void;
  /** Отказы по порядку за всё время прогона. */
  rejections(): string[];
  /** Река на ребре между клеткой и её соседом по направлению dir (0–5), с обеих сторон. */
  river(where: At, dir: number): void;
  /** Задать организованность отряда (0–100). */
  setOrg(unitId: number, org: number): void;
  /** Захват клетки игроком по правилам captureHex (население, ополчение, выработка). */
  capture(where: At, player: string): void;
  /** Перемотать счётчик тиков — для проверки таймера матча. */
  setTick(tick: number): void;
  /** Поставить постройку в клетку в обход строек. */
  setBuilding(where: At, kind: 'fort' | 'depot'): void;
  /** Армии игрока по порядку создания. */
  armiesOf(player: string): Army[];
  /** Отряд по id или undefined. */
  unitById(id: number): Unit | undefined;
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
  const map = buildMap(grid, opts.legend);
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
    if (cell.kind === 'own' && cell.road) state.hexes.road[hex] = 1;
    if (cell.kind !== 'city') return;
    const id = state.nextId;
    state.nextId += 1;
    // Нейтральный город защищает гарнизон по уровню, как на сгенерированных картах.
    // Город игрока защищает полное ополчение (03-cities-buildings.md).
    const defenders =
      owner === NEUTRAL ? (NEUTRAL_GARRISON[cell.level - 1] ?? 0) : MILITIA_PER_LEVEL * cell.level;
    state.cities.push({
      id,
      hex,
      owner,
      level: cell.level,
      name: token,
      defenders: defenders as Fp,
      defenseOrg: ORG_MAX,
      inBattle: false,
      captureTicks: 0,
    });
    const player = state.players[owner];
    if (cell.capital && player) player.capitalCityId = id;
  });
  recomputeAllNetworks(state);
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
  const unitsOf = (p: string): Unit[] => state.units.filter((a) => a.owner === idOf(p));
  const resolve = (ref: UnitRef): number => {
    if (typeof ref === 'number') return ref;
    const unit = unitsOf(ref.unitOf)[ref.index];
    if (!unit) throw new Error(`сценарий: у ${ref.unitOf} нет отряда #${ref.index}`);
    return unit.id;
  };
  const cityIdAt = (w: At): number => state.cities.find((c) => c.hex === hexOf(w))?.id ?? -1;
  const toCommand = (c: DslCommand): Command => {
    switch (c.t) {
      case 'setTax':
        return { t: 'setTax', rate: (c.percent * 10) as Fp };
      case 'attack':
        return { t: 'attack', unitIds: c.units.map(resolve), target: hexOf(c.target) };
      case 'move':
        return { t: 'move', unitIds: c.units.map(resolve), to: hexOf(c.to) };
      case 'setOrder':
        return { t: 'setOrder', unitIds: c.units.map(resolve), order: c.order };
      case 'split':
        return { t: 'split', unitId: resolve(c.unit), soldiers: (c.soldiers * FP) as Fp };
      case 'merge':
        return { t: 'merge', unitIds: c.units.map(resolve) };
      case 'bombard':
        return { t: 'bombard', unitId: resolve(c.unit), targetUnitId: c.targetUnitId };
      case 'createArmy':
      case 'renameArmy':
      case 'disbandArmy':
      case 'armyOrder':
      case 'setAutoReinforce':
        return c;
      case 'assignFront':
        return {
          t: 'assignFront',
          armyId: c.armyId,
          enemyId: idOf(c.enemy),
          section: c.section ? [hexOf(c.section[0]), hexOf(c.section[1])] : null,
        };
      case 'setDefenseLine':
        return { t: 'setDefenseLine', armyId: c.armyId, points: c.points.map(hexOf) };
      case 'clearPlan':
        return c;
      case 'assignUnits':
        return { t: 'assignUnits', unitIds: c.units.map(resolve), armyId: c.armyId };
      case 'upgradeCity':
        return { t: 'upgradeCity', cityId: cityIdAt(c.where) };
      case 'rebuildSupply':
        return { t: 'rebuildSupply', cityId: cityIdAt(c.where) };
      case 'build':
        return { t: 'build', hex: hexOf(c.where), kind: c.kind };
      case 'recruit':
        return {
          t: 'recruit',
          cityId: cityIdAt(c.where),
          type: c.type,
          soldiers: (c.soldiers * FP) as Fp,
        };
      default:
        return { t: c.t, hex: hexOf(c.where) };
    }
  };
  const playerOf = (p: string): Player => {
    const player = state.players[idOf(p)];
    if (!player) throw new Error(`сценарий: нет игрока ${p}`);
    return player;
  };
  return {
    state,
    unit(player, type, soldiers, where) {
      const id = state.nextId;
      state.nextId += 1;
      state.units.push({
        id,
        owner: idOf(player),
        type,
        soldiers: (soldiers * FP) as Fp,
        org: ORG_MAX,
        hex: hexOf(where),
        order: 'idle',
        supplyLevel: FP as Fp,
        path: [],
        moveTicks: 0,
        moveTotal: 0,
        armyId: null,
        lowSupplyTicks: 0,
        encircled: false,
        target: -1,
        inBattle: false,
        focus: -1,
        fireTarget: -1,
        slot: -1,
      });
      return id;
    },
    cmd(player, command) {
      queue.push({ playerId: idOf(player), cmd: toCommand(command) });
    },
    runSeconds(seconds) {
      if (!Number.isInteger(seconds))
        throw new Error('сценарий: runSeconds принимает целые секунды');
      this.runTicks(seconds * TICKS_PER_S);
    },
    runTicks(ticks) {
      for (let i = 0; i < ticks; i += 1) {
        step(state, queue.splice(0));
        log.push(...state.events);
      }
    },
    owner(where) {
      const owner = state.hexes.owner[hexOf(where)] ?? NEUTRAL;
      return owner === NEUTRAL ? null : (letters[owner] ?? null);
    },
    unitsOf,
    lastEvent(t) {
      return [...log].reverse().find((e) => e.t === t);
    },
    pop(where) {
      return state.hexes.pop[hexOf(where)] ?? 0;
    },
    setPop(where, people) {
      state.hexes.pop[hexOf(where)] = people * FP;
    },
    player: playerOf,
    cityAt(where) {
      return state.cities.find((c) => c.hex === hexOf(where));
    },
    setOwner(where, player) {
      const owner = player === null ? NEUTRAL : idOf(player);
      state.hexes.owner[hexOf(where)] = owner;
      const c = state.cities.find((x) => x.hex === hexOf(where));
      if (c) c.owner = owner;
    },
    rejections() {
      return log.flatMap((e) => (e.t === 'commandRejected' ? [e.reason] : []));
    },
    river(where, dir) {
      const { width, height, rivers } = state.map;
      const from = offsetToAxial({ col: where.col, row: where.row });
      const to = neighbors(from)[dir];
      if (!to || !inBounds(to, width, height)) throw new Error('сценарий: река за краем карты');
      const a = hexId(from, width);
      const b = hexId(to, width);
      rivers[a] = (rivers[a] ?? 0) | (1 << dir);
      rivers[b] = (rivers[b] ?? 0) | (1 << ((dir + 3) % 6));
    },
    setOrg(unitId, org) {
      const unit = state.units.find((a) => a.id === unitId);
      if (!unit) throw new Error(`сценарий: нет отряда ${unitId}`);
      unit.org = (org * FP) as Fp;
    },
    capture(where, player) {
      captureHex(state, hexOf(where), idOf(player));
    },
    setTick(tick) {
      state.tick = tick;
    },
    setBuilding(where, kind) {
      state.hexes.building[hexOf(where)] = BUILDING[kind];
    },
    armiesOf(player) {
      return state.armies.filter((a) => a.owner === idOf(player));
    },
    unitById(id) {
      return state.units.find((a) => a.id === id);
    },
  };
}
