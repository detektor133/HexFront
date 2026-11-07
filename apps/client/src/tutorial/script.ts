// Сценарий обучения: одна короткая кампания «первая война». Шаг — одно действие игрока в настоящем
// матче-уроке; он засчитывается, только когда действие сделано (предикат смотрит на состояние
// матча), а не по кнопке «Дальше». Только шаги-объяснения идут по кнопке. Соперником управляет
// режиссёр урока (local/tutorial-director.ts) по номеру шага — он ничего не делает сам по себе.
import {
  CITY_FOUND_MIN_POP_RATIO,
  CITY_MIN_DISTANCE,
  DEPOT_MIN_DISTANCE,
  FP,
  distance,
  fpMul,
  hexFromId,
  hexId,
  hexPopCap,
  inBounds,
  isDepot,
  neighbors,
  TERRAIN,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import type { Picked } from '../dev/sandbox-selection.ts';

export type ChapterId = 'core';

export const CHAPTERS: readonly ChapterId[] = ['core'];

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
  | {
      /** Элемент интерфейса; список — берётся первый из найденных (окно может быть закрыто). */
      readonly ui: string | readonly string[];
      readonly fallbackHex?: (ctx: TutorialCtx) => number | null;
    }
  | { readonly hex: (ctx: TutorialCtx) => number | null }
  /** Фишка отряда на гексе: рамка вокруг самой фишки, а не гекса. */
  | { readonly chip: (ctx: TutorialCtx) => number | null };

export interface Step {
  readonly id: string;
  readonly target?: Target;
  /** Шаг-объяснение: идёт дальше по кнопке «Понятно». */
  readonly manual?: boolean;
  /** Число, с которым предикат сравнивает позднейшее состояние; снимается при входе в шаг. */
  readonly base?: (ctx: TutorialCtx) => number;
  readonly done?: (ctx: TutorialCtx, base: number) => boolean;
  /** Прогресс ожидания 0..1: подсказка рисует полосу, пока шаг ждёт мир (рост людей, сбор армии). */
  readonly progress?: (ctx: TutorialCtx) => number;
}

/** Размер армии, которого урок просит добиться кнопкой «+», солдат. */
export const ARMY_GOAL = 400;

/** Золото в начале матча-урока, монет: хватает на город, склад, дорогу и армию. */
export const START_GOLD = 1500;

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

/** Своя суша без фишек и городов рядом с отрядом: куда нажать, чтобы снять выбор. */
export function ownEmptyNear(ctx: TutorialCtx): number | null {
  const at = unitHex(ctx);
  if (at === null) return null;
  const busy = new Set([...ctx.view.units.map((u) => u.hex), ...ctx.view.cities.map((c) => c.hex)]);
  let best: number | null = null;
  for (let h = 0; h < ctx.view.hexes.owner.length; h += 1) {
    if (ctx.view.hexes.owner[h] !== me(ctx) || busy.has(h) || ctx.map.terrain[h] === TERRAIN.water)
      continue;
    if (best === null || dist(ctx, h, at) < dist(ctx, best, at)) best = h;
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

/** Столица соперника: цель войны. */
export function enemyCapital(
  ctx: TutorialCtx,
): { readonly hex: number; readonly owner: number } | null {
  const city = ctx.view.cities.find((c) => c.isCapital && c.owner >= 0 && c.owner !== me(ctx));
  return city ? { hex: city.hex, owner: city.owner } : null;
}

/** Ближайший к нашей столице гекс соперника: граница, к которой подводят армию. */
export function enemyBorderHex(ctx: TutorialCtx): number | null {
  const foe = enemyCapital(ctx)?.owner;
  const home = ctx.view.cities.find((c) => c.owner === me(ctx) && c.isCapital)?.hex;
  if (foe === undefined || home === undefined) return null;
  let best: number | null = null;
  for (let h = 0; h < ctx.view.hexes.owner.length; h += 1) {
    if (ctx.view.hexes.owner[h] !== foe) continue;
    if (best === null || dist(ctx, h, home) < dist(ctx, best, home)) best = h;
  }
  return best;
}

/** Куда ставить склад: свой гекс без города, ближайший к границе с соперником и не рядом с другим складом. */
export function depotSite(ctx: TutorialCtx): number | null {
  const border = enemyBorderHex(ctx);
  if (border === null) return null;
  const owner = ctx.view.hexes.owner;
  const depots: number[] = [];
  for (let h = 0; h < owner.length; h += 1) {
    if (owner[h] === me(ctx) && isDepot(ctx.view.hexes.building[h] ?? 0)) depots.push(h);
  }
  const cities = new Set(ctx.view.cities.map((c) => c.hex));
  let best: number | null = null;
  for (let h = 0; h < owner.length; h += 1) {
    if (owner[h] !== me(ctx) || cities.has(h) || ctx.map.terrain[h] === TERRAIN.water) continue;
    if (depots.some((d) => dist(ctx, d, h) < DEPOT_MIN_DISTANCE)) continue;
    if (best === null || dist(ctx, h, border) < dist(ctx, best, border)) best = h;
  }
  return best;
}

const taxOf = (ctx: TutorialCtx): number =>
  ctx.view.players.find((p) => p.id === me(ctx))?.taxTarget ?? 0;

const builtOwn = (ctx: TutorialCtx, kind: string): number =>
  ctx.view.constructions.filter((c) => c.kind === kind).length;

/** Склады игрока: достроенные и строящиеся. */
export function depotCount(ctx: TutorialCtx): number {
  let built = 0;
  for (let h = 0; h < ctx.view.hexes.owner.length; h += 1) {
    if (ctx.view.hexes.owner[h] === me(ctx) && isDepot(ctx.view.hexes.building[h] ?? 0)) built += 1;
  }
  return built + builtOwn(ctx, 'depot');
}

const manualRoad = (ctx: TutorialCtx): boolean =>
  ctx.view.constructions.some((c) => c.kind === 'road' && c.manual === true);

const cityCount = (ctx: TutorialCtx): number =>
  ctx.view.cities.filter((x) => x.owner === me(ctx)).length + builtOwn(ctx, 'foundCity');

/** Самый большой заказ размера среди армий игрока, солдат. */
export function armyOrder(ctx: TutorialCtx): number {
  return ctx.view.armies.reduce((max, a) => Math.max(max, a.wanted ?? 0), 0);
}

/** Солдат во всех отрядах игрока. */
export function soldiersOwn(ctx: TutorialCtx): number {
  return Math.floor(ownUnits(ctx).reduce((sum, u) => sum + u.soldiers, 0) / FP);
}

/** Боевые отряды игрока на своём гексе у границы с соперником. */
export function frontUnits(ctx: TutorialCtx) {
  const foe = enemyCapital(ctx)?.owner;
  if (foe === undefined) return [];
  const { width, height } = ctx.map;
  return ownUnits(ctx).filter(
    (u) =>
      u.type !== 'artillery' &&
      neighbors(hexFromId(u.hex, width)).some(
        (n) => inBounds(n, width, height) && ctx.view.hexes.owner[hexId(n, width)] === foe,
      ),
  );
}

/** Насколько армия приблизилась к границе, 0..1: по ближайшему отряду. */
export function frontProgress(ctx: TutorialCtx): number {
  const border = enemyBorderHex(ctx);
  if (border === null) return 0;
  if (frontUnits(ctx).length > 0) return 1;
  const near = Math.min(...ownUnits(ctx).map((u) => dist(ctx, u.hex, border)), 30);
  return Math.max(0, Math.min(1, 1 - (near - 1) / 12));
}

/** Доля снабжения, с которой отряд на фронте считается снабжённым. */
const SUPPLIED = FP * 0.4;

/** Есть ли на фронте снабжаемый отряд. */
export function frontSupplied(ctx: TutorialCtx): boolean {
  return frontUnits(ctx).some((u) => (u.supplyLevel ?? 0) >= SUPPLIED);
}

const CORE: readonly Step[] = [
  { id: 'pan', base: (c) => c.pans, done: (c, b) => c.pans > b },
  { id: 'zoom', base: (c) => c.zooms, done: (c, b) => c.zooms > b },
  { id: 'select', target: { chip: unitHex }, done: (c) => c.picked.units.length > 0 },
  {
    id: 'move',
    target: { hex: neutralNear },
    base: (c) => c.view.hexes.owner.filter((o) => o === me(c)).length,
    done: (c, b) =>
      ownUnits(c).some((u) => u.path.length > 0) ||
      c.view.hexes.owner.filter((o) => o === me(c)).length > b,
  },
  // Пока выбраны отряды или армия, нажатие по земле лишь снимает выбор (или ставит армии приказ),
  // поэтому выбор снимается отдельным шагом: только так нажатие по ничьей земле откроет меню.
  {
    id: 'deselect',
    target: { hex: ownEmptyNear },
    done: (c) => c.picked.units.length === 0 && c.army === null,
  },
  { id: 'menu', target: { hex: neutralNear }, done: (c) => c.menuOther === -1 },
  {
    id: 'occupy',
    target: { ui: 'occupy', fallbackHex: neutralNear },
    done: (c) => c.view.armies.some((a) => a.dir?.target === -1 && a.dir.mode === 'attack'),
  },
  { id: 'economy', manual: true, target: { ui: 'pop' } },
  { id: 'tax', target: { ui: ['tax-slider', 'tax'] }, base: taxOf, done: (c, b) => taxOf(c) !== b },
  {
    id: 'wait',
    target: { hex: citySite },
    progress: cityProgress,
    done: (c) => cityProgress(c) >= 1,
  },
  {
    id: 'city',
    target: { ui: 'found-city', fallbackHex: citySite },
    base: cityCount,
    done: (c, b) => cityCount(c) > b,
  },
  { id: 'supplyMode', target: { ui: 'supply-mode' }, done: (c) => c.mapMode === 'supply' },
  { id: 'hammer', target: { ui: 'hammer' }, done: (c) => c.build !== null },
  { id: 'depotTool', target: { ui: 'build-depot' }, done: (c) => c.build === 'depot' },
  { id: 'depot', target: { hex: depotSite }, base: depotCount, done: (c, b) => depotCount(c) > b },
  { id: 'roadTool', target: { ui: 'build-road' }, done: (c) => c.build === 'road' },
  { id: 'road', target: { ui: 'build-hint' }, done: (c) => manualRoad(c) },
  { id: 'armyPick', target: { ui: 'army-card' }, done: (c) => c.army !== null },
  { id: 'armyPlus', target: { ui: 'army-stronger' }, done: (c) => armyOrder(c) >= ARMY_GOAL },
  {
    id: 'recruit',
    progress: (c) => Math.min(1, soldiersOwn(c) / (ARMY_GOAL * 0.9)),
    done: (c) => soldiersOwn(c) >= ARMY_GOAL * 0.9,
  },
  {
    id: 'enemy',
    target: { hex: enemyBorderHex },
    done: (c) => c.menuOther !== null && c.menuOther === (enemyCapital(c)?.owner ?? -99),
  },
  {
    id: 'hold',
    target: { ui: 'hold', fallbackHex: enemyBorderHex },
    done: (c) => c.view.armies.some((a) => a.dir?.target === (enemyCapital(c)?.owner ?? -99)),
  },
  {
    id: 'front',
    target: { hex: enemyBorderHex },
    progress: frontProgress,
    done: (c) => frontUnits(c).length > 0,
  },
  {
    id: 'supplyFront',
    target: { hex: (c) => frontUnits(c)[0]?.hex ?? enemyBorderHex(c) },
    done: frontSupplied,
  },
  {
    id: 'war',
    target: { ui: 'declare-war', fallbackHex: enemyBorderHex },
    done: (c) => {
      const foe = enemyCapital(c)?.owner;
      return foe !== undefined && c.view.diplomacy?.relations[foe] === 'war';
    },
  },
  {
    id: 'attack',
    target: { ui: 'attack', fallbackHex: enemyBorderHex },
    done: (c) =>
      c.view.armies.some(
        (a) => a.dir?.target === (enemyCapital(c)?.owner ?? -99) && a.dir.mode === 'attack',
      ),
  },
  {
    id: 'conquer',
    target: { hex: (c) => enemyCapital(c)?.hex ?? null },
    // Столица соперника на входе в шаг: после взятия она уже не его, и искать её нечем.
    base: (c) => enemyCapital(c)?.hex ?? -1,
    done: (c, b) =>
      c.view.winner >= 0 || (b >= 0 && c.view.cities.some((x) => x.hex === b && x.owner === me(c))),
  },
  { id: 'finish', manual: true },
];

/** Шаги обучения. */
export const STEPS: Readonly<Record<ChapterId, readonly Step[]>> = {
  core: CORE,
};
