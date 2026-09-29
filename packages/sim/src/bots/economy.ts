// Экономический мозг бота (04/T23, CR-006; gdd/09-bots.md, «Utility AI»): только по снимку игрока,
// те же команды, что у игрока. Военная часть — commander; здесь — налог, стройки, набор, дорога и
// когда нажать ▶ «Начать» у армии с auto. За одно решение — не больше одной траты: сначала дорога
// к изолированному городу, затем набор (если у границы слабее врага), город, благоустройство,
// улучшение города.
import {
  BOT_GOLD_RESERVE,
  BOT_IMPROVE_POP_RATIO,
  BOT_RECRUIT_RATIO,
  BOT_TAX_PEACE,
  BOT_TAX_WAR,
  CITY_FOUND_MIN_POP_RATIO,
  CITY_MIN_DISTANCE,
  CITY_UPGRADE_COST,
  COST_GOLD_PER_SOLDIER,
  IMPROVEMENT_COST,
  RECRUIT_MIN,
  RECRUIT_STEP,
  TAX_MAX,
} from '../balance.ts';
import type { Command } from '../commands/types.ts';
import type { MapStatic } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { fpDiv, fpMul, type Fp } from '../math/int.ts';
import { forecastBattle } from '../queries/forecast.ts';
import type { PlayerView } from '../queries/player-view.ts';
import { edgeOther } from '../state/edges.ts';
import { hexPopCap } from '../state/pop-cap.ts';

/** Радиус благоустройства вокруг города, гексов: кольца роста города (02-economy.md). */
const CITY_RING = 2;

const around = (map: MapStatic, h: HexId): HexId[] =>
  neighbors(hexFromId(h, map.width))
    .filter((n) => inBounds(n, map.width, map.height))
    .map((n) => hexId(n, map.width));

const isEnemy = (view: PlayerView, owner: number): boolean => owner >= 0 && owner !== view.playerId;

// Свои гексы у границы с врагом и гексы врага у своей границы.
function contact(map: MapStatic, view: PlayerView): { mine: Set<HexId>; theirs: Set<HexId> } {
  const mine = new Set<HexId>();
  const theirs = new Set<HexId>();
  view.hexes.owner.forEach((o, h) => {
    if (o !== view.playerId) return;
    for (const n of around(map, h)) {
      if (!isEnemy(view, view.hexes.owner[n] ?? -1)) continue;
      mine.add(h);
      theirs.add(n);
    }
  });
  return { mine, theirs };
}

function taxCommand(view: PlayerView, war: boolean): Command[] {
  const me = view.players[view.playerId];
  if (!me) return [];
  const net = view.me.incomePerS - view.me.upkeepPerS;
  const broke = me.gold < BOT_GOLD_RESERVE && net < 0;
  const rate = broke ? TAX_MAX : war ? BOT_TAX_WAR : BOT_TAX_PEACE;
  return me.taxTarget === rate ? [] : [{ t: 'setTax', rate }];
}

// Изолированный свой город, до столицы есть путь, дорога ещё не идёт — перестройка снабжения.
function roadCommand(view: PlayerView, gold: Fp): Command | null {
  if (gold < BOT_GOLD_RESERVE) return null;
  const roads = new Set(view.constructions.filter((c) => c.kind === 'road').map((c) => c.hex));
  const city = view.cities.find((c) => c.canRebuild && !roads.has(c.hex));
  return city ? { t: 'rebuildSupply', cityId: city.id } : null;
}

// Набор, если солдат на своих гексах у границы меньше BOT_RECRUIT_RATIO × солдат врага у неё и
// лимит отрядов не исчерпан: пехота в своём городе с наибольшим набором, где нет очереди, —
// сколько даёт город и хватает золота (шагом RECRUIT_STEP).
function recruitCommand(
  view: PlayerView,
  near: ReturnType<typeof contact>,
  gold: Fp,
): Command | null {
  const sum = (hexes: Set<HexId>, mine: boolean): number =>
    view.units
      .filter((u) => (u.owner === view.playerId) === mine && hexes.has(u.hex))
      .reduce((s, u) => s + u.soldiers, 0);
  const enemy = sum(near.theirs, false);
  if (enemy === 0 || sum(near.mine, true) >= fpMul(enemy as Fp, BOT_RECRUIT_RATIO)) return null;
  const used = view.units.filter((u) => u.owner === view.playerId).length + view.recruits.length;
  if (used >= view.me.unitLimit) return null;
  const busy = new Set(view.recruits.map((r) => r.cityId));
  const city = view.cities
    .filter((c) => c.owner === view.playerId && !busy.has(c.id))
    .sort((a, b) => b.recruitMax - a.recruitMax || a.id - b.id)[0];
  if (!city) return null;
  const afford = fpDiv(gold, COST_GOLD_PER_SOLDIER.infantry);
  const soldiers = Math.min(city.recruitMax, afford - (afford % RECRUIT_STEP)) as Fp;
  return soldiers >= RECRUIT_MIN
    ? { t: 'recruit', cityId: city.id, type: 'infantry', soldiers }
    : null;
}

// Свободный свой гекс (не город, без стройки).
function freeHexes(view: PlayerView): HexId[] {
  const cities = new Set(view.cities.map((c) => c.hex));
  const busy = new Set(view.constructions.filter((c) => c.kind !== 'road').map((c) => c.hex));
  const out: HexId[] = [];
  view.hexes.owner.forEach((o, h) => {
    if (o === view.playerId && !cities.has(h) && !busy.has(h)) out.push(h);
  });
  return out;
}

// Больше населения — лучше; при равенстве — меньший HexId.
const byPop = (view: PlayerView) => (a: HexId, b: HexId) =>
  (view.hexes.pop[b] ?? 0) - (view.hexes.pop[a] ?? 0) || a - b;

function foundCommand(map: MapStatic, view: PlayerView, gold: Fp): Command | null {
  if (gold < view.me.foundCityCost + BOT_GOLD_RESERVE) return null;
  const g = { map, hexes: view.hexes };
  const sites = [
    ...view.cities.map((c) => c.hex),
    ...view.constructions.filter((c) => c.kind === 'foundCity').map((c) => c.hex),
  ].map((h) => hexFromId(h, map.width));
  const ok = freeHexes(view).filter((h) => {
    const p = hexFromId(h, map.width);
    if (sites.some((s) => distance(s, p) < CITY_MIN_DISTANCE)) return false;
    return (view.hexes.pop[h] ?? 0) >= fpMul(hexPopCap(g, h), CITY_FOUND_MIN_POP_RATIO);
  });
  const hex = ok.sort(byPop(view))[0];
  return hex === undefined ? null : { t: 'foundCity', hex };
}

// Гексы в кольцах своих городов с населением ≥ BOT_IMPROVE_POP_RATIO лимита.
function improveCommand(map: MapStatic, view: PlayerView, gold: Fp): Command | null {
  const g = { map, hexes: view.hexes };
  const cities = view.cities
    .filter((c) => c.owner === view.playerId)
    .map((c) => hexFromId(c.hex, map.width));
  const ok = freeHexes(view).filter((h) => {
    const cost = IMPROVEMENT_COST[view.hexes.improvement[h] ?? 0];
    if (cost === undefined || gold < cost + BOT_GOLD_RESERVE) return false;
    const p = hexFromId(h, map.width);
    if (!cities.some((c) => distance(c, p) <= CITY_RING)) return false;
    return (view.hexes.pop[h] ?? 0) >= fpMul(hexPopCap(g, h), BOT_IMPROVE_POP_RATIO);
  });
  const hex = ok.sort(byPop(view))[0];
  return hex === undefined ? null : { t: 'improve', hex };
}

// Улучшение своего города с наименьшим уровнем (при равенстве — меньший id), без стройки в нём,
// если хватает золота с резервом: остаток золота бота не лежит без дела.
function upgradeCommand(view: PlayerView, gold: Fp): Command | null {
  const busy = new Set(view.constructions.filter((c) => c.kind !== 'road').map((c) => c.hex));
  const city = view.cities
    .filter((c) => c.owner === view.playerId && !busy.has(c.hex))
    .filter((c) => {
      const cost = CITY_UPGRADE_COST[c.level - 1];
      return cost !== undefined && gold >= cost + BOT_GOLD_RESERVE;
    })
    .sort((a, b) => a.level - b.level || a.id - b.id)[0];
  return city ? { t: 'upgradeCity', cityId: city.id } : null;
}

// ▶ у армий с auto, у которых фронт без наступления: на участке есть вражеский гекс, который
// отряды армии рядом с ним берут с прогнозом «победа». Линию строит commander.
function startCommands(map: MapStatic, view: PlayerView): Command[] {
  const g = { map, hexes: view.hexes };
  const out: Command[] = [];
  for (const army of view.armies.filter((a) => a.auto)) {
    const plan = view.plans.find((p) => p.armyId === army.id);
    if (plan?.kind !== 'front' || plan.offensive || plan.startWanted) continue;
    const units = view.units.filter(
      (u) => u.armyId === army.id && u.type !== 'artillery' && u.order === 'idle',
    );
    const targets = [...new Set(plan.edges.map((e) => edgeOther(g, e)))]
      .filter((h) => isEnemy(view, view.hexes.owner[h] ?? -1))
      .sort((a, b) => a - b);
    const win = targets.some((t) => {
      const ids = units.filter((u) => around(map, t).includes(u.hex)).map((u) => u.id);
      return ids.length > 0 && forecastBattle(map, view, ids, t).outcome === 'victory';
    });
    if (win) out.push({ t: 'startOffensive', armyId: army.id });
  }
  return out;
}

/**
 * Решение экономического мозга бота по снимку игрока (09-bots.md, «Utility AI»).
 * @returns команды: настройки и налог, ▶ армиям, не больше одной траты
 */
export function economyDecide(map: MapStatic, view: PlayerView): Command[] {
  const me = view.players[view.playerId];
  if (!me) return [];
  const near = contact(map, view);
  const out: Command[] = [];
  if (!view.me.autoReinforce) out.push({ t: 'setAutoReinforce', on: true });
  out.push(...taxCommand(view, near.mine.size > 0));
  out.push(...startCommands(map, view));
  if (view.me.bankrupt) return out;
  const spend =
    roadCommand(view, me.gold) ??
    recruitCommand(view, near, me.gold) ??
    foundCommand(map, view, me.gold) ??
    improveCommand(map, view, me.gold) ??
    upgradeCommand(view, me.gold);
  if (spend) out.push(spend);
  return out;
}
