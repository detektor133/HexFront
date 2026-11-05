// Сценарий обучения: главы и шаги. Шаг — одно действие игрока в настоящем матче-уроке; он
// засчитывается, только когда действие сделано (предикат смотрит на состояние матча), а не по
// кнопке «Дальше». Только шаги-объяснения идут по кнопке.
import {
  CITY_FOUND_MIN_POP_RATIO,
  CITY_MIN_DISTANCE,
  distance,
  fpMul,
  hexFromId,
  hexPopCap,
  TERRAIN,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import type { Picked } from '../dev/sandbox-selection.ts';

export type ChapterId = 'core' | 'supply' | 'armies' | 'building';

export const CHAPTERS: readonly ChapterId[] = ['core', 'supply', 'armies', 'building'];

/** Что шаг знает о матче: снимок, выбор, открытые окна и движение камеры. */
export interface TutorialCtx {
  readonly view: PlayerView;
  readonly map: MapStatic;
  readonly picked: Picked;
  /** Открытое меню земли: id владельца (−1 — ничья земля) или null. */
  readonly menuOther: number | null;
  readonly army: number | null;
  readonly build: string | null;
  readonly mapMode: string;
  readonly buildingsOpen: boolean;
  /** Сколько раз игрок сдвинул карту и сменил масштаб с начала урока. */
  readonly pans: number;
  readonly zooms: number;
}

/** Куда смотрит подсказка: элемент интерфейса по `data-tutorial` или гекс на карте. */
export type Target =
  | { readonly ui: string; readonly fallbackHex?: (ctx: TutorialCtx) => number | null }
  | { readonly hex: (ctx: TutorialCtx) => number | null };

export interface Step {
  readonly id: string;
  readonly target?: Target;
  /** Шаг-объяснение: идёт дальше по кнопке «Понятно». */
  readonly manual?: boolean;
  /** Число, с которым предикат сравнивает позднейшее состояние; снимается при входе в шаг. */
  readonly base?: (ctx: TutorialCtx) => number;
  readonly done?: (ctx: TutorialCtx, base: number) => boolean;
  /** Прогресс ожидания 0..1: подсказка рисует полосу, пока шаг ждёт мир (рост людей). */
  readonly progress?: (ctx: TutorialCtx) => number;
}

const me = (ctx: TutorialCtx): number => ctx.view.playerId;

function ownUnits(ctx: TutorialCtx) {
  return ctx.view.units.filter((u) => u.owner === me(ctx));
}

const dist = (ctx: TutorialCtx, a: number, b: number): number =>
  distance(hexFromId(a, ctx.map.width), hexFromId(b, ctx.map.width));

/** Гекс первого своего отряда. */
export function unitHex(ctx: TutorialCtx): number | null {
  return ownUnits(ctx)[0]?.hex ?? null;
}

/** Ничья суша рядом со своей землёй, ближе всего к центру карты: куда посылать войска. */
export function neutralNear(ctx: TutorialCtx): number | null {
  const { width, height, terrain } = ctx.map;
  const owner = ctx.view.hexes.owner;
  const center = Math.floor(width / 2) + Math.floor(height / 2) * width;
  const busy = new Set([...ctx.view.units.map((u) => u.hex), ...ctx.view.cities.map((c) => c.hex)]);
  let best: number | null = null;
  for (let h = 0; h < owner.length; h += 1) {
    if (owner[h] !== -1 || terrain[h] === TERRAIN.water || busy.has(h)) continue;
    const near = dist(ctx, h, unitHex(ctx) ?? h) <= 3 && dist(ctx, h, unitHex(ctx) ?? h) >= 2;
    if (!near) continue;
    if (best === null || dist(ctx, h, center) < dist(ctx, best, center)) best = h;
  }
  return best;
}

/** Лучший свой гекс для города: дальше всего от других городов и ближе всего к нужным людям. */
export function citySite(ctx: TutorialCtx): number | null {
  const owner = ctx.view.hexes.owner;
  const sites = [
    ...ctx.view.cities.map((c) => c.hex),
    ...ctx.view.constructions.filter((c) => c.kind === 'foundCity').map((c) => c.hex),
  ];
  let best: number | null = null;
  let bestRatio = -1;
  for (let h = 0; h < owner.length; h += 1) {
    if (owner[h] !== me(ctx) || ctx.map.terrain[h] === TERRAIN.water) continue;
    if (sites.some((s) => dist(ctx, s, h) < CITY_MIN_DISTANCE)) continue;
    const need = fpMul(
      hexPopCap({ map: ctx.map, hexes: ctx.view.hexes }, h),
      CITY_FOUND_MIN_POP_RATIO,
    );
    if (need <= 0) continue;
    const ratio = (ctx.view.hexes.pop[h] ?? 0) / need;
    if (ratio > bestRatio) {
      best = h;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Насколько на лучшем гексе набралось людей для города, 0..1. */
export function cityProgress(ctx: TutorialCtx): number {
  const site = citySite(ctx);
  if (site === null) return 0;
  const need = fpMul(
    hexPopCap({ map: ctx.map, hexes: ctx.view.hexes }, site),
    CITY_FOUND_MIN_POP_RATIO,
  );
  return need <= 0 ? 0 : Math.min(1, (ctx.view.hexes.pop[site] ?? 0) / need);
}

function capitalHex(ctx: TutorialCtx): number | null {
  return ctx.view.cities.find((c) => c.owner === me(ctx) && c.isCapital)?.hex ?? null;
}

function enemyCity(ctx: TutorialCtx): { readonly hex: number; readonly owner: number } | null {
  const city = ctx.view.cities.find((c) => c.owner >= 0 && c.owner !== me(ctx));
  return city ? { hex: city.hex, owner: city.owner } : null;
}

const taxOf = (ctx: TutorialCtx): number =>
  ctx.view.players.find((p) => p.id === me(ctx))?.taxTarget ?? 0;

const builtOwn = (ctx: TutorialCtx, kind: string): number =>
  ctx.view.constructions.filter((c) => c.kind === kind).length;

const CORE: readonly Step[] = [
  { id: 'welcome', manual: true },
  { id: 'pan', base: (c) => c.pans, done: (c, b) => c.pans > b },
  { id: 'zoom', base: (c) => c.zooms, done: (c, b) => c.zooms > b },
  { id: 'select', target: { hex: unitHex }, done: (c) => c.picked.units.length > 0 },
  {
    id: 'move',
    target: { hex: neutralNear },
    base: (c) => c.view.hexes.owner.filter((o) => o === me(c)).length,
    done: (c, b) =>
      ownUnits(c).some((u) => u.path.length > 0) ||
      c.view.hexes.owner.filter((o) => o === me(c)).length > b,
  },
  { id: 'menu', target: { hex: neutralNear }, done: (c) => c.menuOther === -1 },
  {
    id: 'occupy',
    target: { ui: 'occupy', fallbackHex: neutralNear },
    done: (c) => c.view.armies.some((a) => a.dir?.target === -1 && a.dir.mode === 'attack'),
  },
  { id: 'people', manual: true, target: { ui: 'pop' } },
  { id: 'gold', manual: true, target: { ui: 'gold' } },
  { id: 'tax', target: { ui: 'tax' }, base: taxOf, done: (c, b) => taxOf(c) !== b },
  {
    id: 'wait',
    target: { hex: citySite },
    progress: cityProgress,
    done: (c) => cityProgress(c) >= 1,
  },
  {
    id: 'city',
    target: { ui: 'found-city', fallbackHex: citySite },
    base: (c) => c.view.cities.filter((x) => x.owner === me(c)).length + builtOwn(c, 'foundCity'),
    done: (c, b) =>
      c.view.cities.filter((x) => x.owner === me(c)).length + builtOwn(c, 'foundCity') > b,
  },
  {
    id: 'recruit',
    target: { ui: 'recruit', fallbackHex: capitalHex },
    base: (c) => c.view.recruits.length,
    done: (c, b) => c.view.recruits.length > b,
  },
  {
    id: 'hammer',
    target: { ui: 'hammer' },
    done: (c) => c.build !== null,
  },
  {
    id: 'improveTool',
    target: { ui: 'build-improve' },
    done: (c) => c.build === 'improve',
  },
  {
    id: 'improve',
    base: (c) => builtOwn(c, 'improve'),
    done: (c, b) => builtOwn(c, 'improve') > b,
  },
  {
    id: 'enemy',
    target: { hex: (c) => enemyCity(c)?.hex ?? null },
    done: (c) => c.menuOther !== null && c.menuOther === (enemyCity(c)?.owner ?? -99),
  },
  {
    id: 'war',
    target: { ui: 'declare-war', fallbackHex: (c) => enemyCity(c)?.hex ?? null },
    done: (c) => {
      const foe = enemyCity(c)?.owner;
      return foe !== undefined && c.view.diplomacy?.relations[foe] === 'war';
    },
  },
  {
    id: 'attack',
    target: { ui: 'attack', fallbackHex: (c) => enemyCity(c)?.hex ?? null },
    done: (c) =>
      c.view.armies.some(
        (a) => a.dir?.target === (enemyCity(c)?.owner ?? -99) && a.dir.mode === 'attack',
      ),
  },
  { id: 'finish', manual: true },
];

const SUPPLY: readonly Step[] = [
  { id: 'intro', manual: true, target: { ui: 'supply' } },
  { id: 'mode', target: { ui: 'supply-mode' }, done: (c) => c.mapMode === 'supply' },
  { id: 'hammer', target: { ui: 'hammer' }, done: (c) => c.build !== null },
  { id: 'depotTool', target: { ui: 'build-depot' }, done: (c) => c.build === 'depot' },
  {
    id: 'depot',
    base: (c) => builtOwn(c, 'depot'),
    done: (c, b) => builtOwn(c, 'depot') > b,
  },
  { id: 'finish', manual: true },
];

const ARMIES: readonly Step[] = [
  { id: 'cards', manual: true, target: { ui: 'army-card' } },
  { id: 'pick', target: { ui: 'army-card' }, done: (c) => c.army !== null },
  {
    id: 'limit',
    target: { ui: 'army-limit' },
    done: (c) => c.view.armies.some((a) => a.wanted !== undefined),
  },
  {
    id: 'split',
    target: { ui: 'army-split' },
    base: (c) => c.view.armies.length,
    done: (c, b) => c.view.armies.length > b,
  },
  { id: 'finish', manual: true },
];

const BUILDING: readonly Step[] = [
  { id: 'hammer', target: { ui: 'hammer' }, done: (c) => c.build !== null },
  { id: 'fortTool', target: { ui: 'build-fort' }, done: (c) => c.build === 'fort' },
  { id: 'fort', base: (c) => builtOwn(c, 'fort'), done: (c, b) => builtOwn(c, 'fort') > b },
  { id: 'improveTool', target: { ui: 'build-improve' }, done: (c) => c.build === 'improve' },
  {
    id: 'improve',
    base: (c) => builtOwn(c, 'improve'),
    done: (c, b) => builtOwn(c, 'improve') > b,
  },
  { id: 'list', target: { ui: 'buildings' }, done: (c) => c.buildingsOpen },
  { id: 'finish', manual: true },
];

/** Шаги главы. */
export const STEPS: Readonly<Record<ChapterId, readonly Step[]>> = {
  core: CORE,
  supply: SUPPLY,
  armies: ARMIES,
  building: BUILDING,
};

/** Золото в начале матча-урока, монет: главе стройки и армий нужен запас. */
export const START_GOLD: Readonly<Record<ChapterId, number>> = {
  core: 200,
  supply: 600,
  armies: 600,
  building: 600,
};
