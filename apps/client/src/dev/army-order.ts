// Приказы «Держать», «Наступать» и «Занять» из сигнала границы и меню страны: какая армия идёт
// (свободная ближайшая, выбранная игроком или новая «в паритете» с соседом) и с каким размером.
import {
  COST_GOLD_PER_SOLDIER,
  FP,
  distance,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type ArmyView,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { armyLevels, maxArmySoldiers } from './army-limit.ts';
import { NEW_ARMY, ORDER_TYPES, armyCounts, orderFields, type Counts } from './direction-order.ts';
import { countsFromShares, defaultShares, sharesFromCounts } from './force-share.ts';

/** Целей-соседей дальше стольких гексов от своей границы паритет не учитывает. */
const THREAT_RANGE = 3;

/** Свободная армия — без приказа (ни фронта, ни занятия земли). */
export function isFree(army: ArmyView): boolean {
  return army.dir === undefined || army.dir.mode === 'idle';
}

/** Армия, уже стоящая на цель: действующая важнее армии с снятым направлением (idle). */
export function armyOn(view: PlayerView, target: number): ArmyView | undefined {
  const mine = view.armies.filter((a) => a.dir?.target === target);
  return mine.find((a) => a.dir?.mode !== 'idle') ?? mine[0];
}

/** Свои гексы, граничащие с землёй игрока `target`: по ним считаются близость и паритет. */
export function borderHexes(view: PlayerView, map: MapStatic, target: number): number[] {
  const found: number[] = [];
  for (let hex = 0; hex < view.hexes.owner.length; hex += 1) {
    if (view.hexes.owner[hex] !== view.playerId) continue;
    const touches = neighbors(hexFromId(hex, map.width)).some(
      (n) => inBounds(n, map.width, map.height) && view.hexes.owner[hexId(n, map.width)] === target,
    );
    if (touches) found.push(hex);
  }
  return found;
}

/** Соседи со своей границей: id страны → один из своих гексов у границы. */
export function contacts(view: PlayerView, map: MapStatic): Map<number, number> {
  const found = new Map<number, number>();
  for (let hex = 0; hex < view.hexes.owner.length; hex += 1) {
    if (view.hexes.owner[hex] !== view.playerId) continue;
    for (const n of neighbors(hexFromId(hex, map.width))) {
      if (!inBounds(n, map.width, map.height)) continue;
      const other = view.hexes.owner[hexId(n, map.width)] ?? -1;
      if (other < 0 || other === view.playerId || found.has(other)) continue;
      if (view.players[other]?.status === 'alive') found.set(other, hex);
    }
  }
  return found;
}

/** Расстояние от армии до гекса: ближайший её отряд; у армии без отрядов — бесконечность. */
function armyDistance(view: PlayerView, map: MapStatic, army: ArmyView, hex: number): number {
  const target = hexFromId(hex, map.width);
  let best = Number.POSITIVE_INFINITY;
  for (const u of view.units) {
    if (u.owner !== view.playerId || u.armyId !== army.id) continue;
    best = Math.min(best, distance(hexFromId(u.hex, map.width), target));
  }
  return best;
}

/** Ближайшая к гексу свободная армия или undefined, если свободных нет. */
export function nearestFreeArmy(
  view: PlayerView,
  map: MapStatic,
  hex: number,
): ArmyView | undefined {
  return view.armies
    .filter(isFree)
    .map((army) => ({ army, d: armyDistance(view, map, army, hex) }))
    .sort((a, b) => a.d - b.d || a.army.number - b.army.number)[0]?.army;
}

/**
 * Размер новой армии «в паритете»: уровень не меньше силы соседа у нашей границы (его отряды в
 * пределах `THREAT_RANGE` гексов от неё, видимые игроку); меньше роты не бывает.
 * @returns солдат
 */
export function parityLevel(view: PlayerView, map: MapStatic, target: number): number {
  const border = borderHexes(view, map, target).map((h) => hexFromId(h, map.width));
  let enemy = 0;
  for (const u of view.units) {
    if (u.owner !== target) continue;
    const at = hexFromId(u.hex, map.width);
    if (border.some((b) => distance(b, at) <= THREAT_RANGE)) enemy += Math.floor(u.soldiers / FP);
  }
  const levels = armyLevels(maxArmySoldiers(view));
  return levels.find((size) => size >= enemy) ?? levels.at(-1) ?? 1;
}

/** Золото на солдат состава: пехота, бронетехника и артиллерия стоят по-разному. */
export function countsGold(counts: Counts): number {
  return ORDER_TYPES.reduce(
    (sum, type) => sum + Math.round((counts[type] * COST_GOLD_PER_SOLDIER[type]) / FP),
    0,
  );
}

/** Солдаты армии в отрядах по типам, целые. */
function haveCounts(view: PlayerView, army: ArmyView): Counts {
  const have: Counts = { infantry: 0, armor: 0, artillery: 0 };
  for (const u of view.units) {
    if (u.owner === view.playerId && u.armyId === army.id)
      have[u.type] += Math.floor(u.soldiers / FP);
  }
  return have;
}

/** Состав новой армии на соседа: размер «в паритете» и доли по умолчанию 75/20/5. */
export function newArmyCounts(view: PlayerView, map: MapStatic, target: number): Counts {
  const soldiers = parityLevel(view, map, target);
  return countsFromShares(soldiers, defaultShares(view, soldiers));
}

/** Золото на создание новой армии «в паритете» с соседом. */
export function newArmyCost(view: PlayerView, map: MapStatic, target: number): number {
  return countsGold(newArmyCounts(view, map, target));
}

/** Кого возьмёт автомат: готовую армию (стоящую на цель или свободную рядом) или новую с ценой. */
export type AutoArmy =
  | { readonly kind: 'new'; readonly cost: number }
  | { readonly kind: 'army'; readonly army: ArmyView };

/**
 * Армия, которую выберет автоподбор приказа на соседа (так же, как в autoOrder).
 * @returns готовая армия или новая с золотом на набор
 */
export function autoArmy(
  view: PlayerView,
  map: MapStatic,
  target: number,
  nearHex: number,
): AutoArmy {
  const current = armyOn(view, target);
  const army = current ?? nearestFreeArmy(view, map, nearHex);
  return army ? { kind: 'army', army } : { kind: 'new', cost: newArmyCost(view, map, target) };
}

/**
 * Золото, чтобы довести армию до заданного размера с её долями типов: докупается только недостающее
 * по каждому типу (уже стоящие отряды не оплачиваются снова).
 */
export function armyResizeCost(view: PlayerView, army: ArmyView, size: number): number {
  const wanted = countsFromShares(size, sharesFromCounts(armyCounts(view, army)));
  const have = haveCounts(view, army);
  return countsGold({
    infantry: Math.max(0, wanted.infantry - have.infantry),
    armor: Math.max(0, wanted.armor - have.armor),
    artillery: Math.max(0, wanted.artillery - have.artillery),
  });
}

/** Приказ армии на цель в нужном режиме: размер и состав армии сохраняются. */
export function orderArmy(
  view: PlayerView,
  army: ArmyView,
  target: number,
  mode: 'hold' | 'attack',
  hex?: number,
): Command {
  return {
    t: mode === 'hold' ? 'holdBorder' : 'launchOffensive',
    target,
    ...orderFields(armyCounts(view, army), army.id),
    ...(hex === undefined ? {} : { hex }),
  };
}

/** Приказ новой армии с размером по паритету. */
export function orderNewArmy(
  view: PlayerView,
  map: MapStatic,
  target: number,
  mode: 'hold' | 'attack',
): Command {
  return {
    t: mode === 'hold' ? 'holdBorder' : 'launchOffensive',
    target,
    ...orderFields(newArmyCounts(view, map, target), NEW_ARMY),
  };
}

/**
 * Приказ «автоподбор»: армия, уже стоящая на цель; иначе ближайшая свободная; иначе новая по
 * паритету. Занятую чужим делом армию автомат не берёт.
 */
export function autoOrder(
  view: PlayerView,
  map: MapStatic,
  target: number,
  mode: 'hold' | 'attack',
  nearHex: number,
): Command {
  const current = armyOn(view, target);
  const army = current ?? nearestFreeArmy(view, map, nearHex);
  return army ? orderArmy(view, army, target, mode) : orderNewArmy(view, map, target, mode);
}

/** Армия держит или атакует эту страну: приказ на неё саму или на весь блок врагов, куда она входит. */
export function covers(view: PlayerView, army: ArmyView, other: number): boolean {
  const dir = army.dir;
  if (dir === undefined || dir.mode === 'idle') return false;
  if (dir.target === other) return true;
  const blocs = view.diplomacy?.blocs;
  return dir.bloc === true && blocs !== undefined && blocs[dir.target] === blocs[other];
}

/** Во сколько раз счёт соседа должен отличаться от нашего, чтобы считать его сильнее или слабее. */
const STRENGTH_GAP = 1.4;

/**
 * Приблизительная сила соседа относительно нас по очкам рейтинга (города, земля, войска): точных
 * войск врага игрок не знает, ему нужен лишь знак «полезешь на сильного».
 * @returns null, если рейтинга нет
 */
export function strengthVs(view: PlayerView, other: number): 'stronger' | 'even' | 'weaker' | null {
  const ranking = view.ranking;
  const mine = ranking?.find((r) => r.id === view.playerId)?.score;
  const theirs = ranking?.find((r) => r.id === other)?.score;
  if (mine === undefined || theirs === undefined) return null;
  const mineSafe = Math.max(1, mine);
  if (theirs > mineSafe * STRENGTH_GAP) return 'stronger';
  if (theirs * STRENGTH_GAP < mineSafe) return 'weaker';
  return 'even';
}
