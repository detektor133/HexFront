// Режимы рисования планов армии (07-controls.md, «Планы армий», CR-003): участок фронта и линия
// наступления — по граням гексов, линия обороны — по своим гексам. Палец или ЛКМ ведут линию,
// тап добавляет точку, между точками линия достраивается сама; тап по границе с врагом берёт
// весь её непрерывный кусок.
import {
  borderSegment,
  defenseLinePath,
  frontLinePath,
  hexId,
  inBounds,
  offensiveLinePath,
  TERRAIN,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { distanceTo, isBorderEdge, nearestEdge, type Ground } from './plan-edges.ts';
import { pixelToHex, type Point } from '../render/hex-geometry.ts';

export type DraftMode = 'front' | 'line' | 'offensive';

/** Рисуемый план: режим, армия и точки-гексы по порядку. */
export interface Draft {
  readonly mode: DraftMode;
  readonly armyId: number;
  readonly points: readonly number[];
}

/** Что нужно для перевода точки экрана в гексы плана. */
export interface DraftContext {
  readonly map: MapStatic;
  readonly view: PlayerView;
  readonly radius: number;
  /** Текущий фронт армии — с какой стороны грани наступления «свой» гекс. */
  readonly front: readonly number[];
}

const ground = (c: DraftContext): Ground => ({
  map: c.map,
  owner: c.view.hexes.owner,
  me: c.view.playerId,
});

const isLand = (map: MapStatic, h: number): boolean =>
  h >= 0 && map.terrain[h] !== undefined && map.terrain[h] !== TERRAIN.water;

function hexUnder(c: DraftContext, world: Point): number {
  const h = pixelToHex(world, c.radius);
  return inBounds(h, c.map.width, c.map.height) ? hexId(h, c.map.width) : -1;
}

/**
 * Гексы, которые добавляет точка world. Фронт — свой гекс ближайшей грани границы (тап по
 * границе с врагом — весь её непрерывный кусок); наступление — гекс ближайшей грани со стороны
 * фронта армии; линия обороны — свой гекс под точкой.
 * @returns гексы по порядку или пусто, если рядом нет подходящей грани
 */
export function pointAt(c: DraftContext, mode: DraftMode, world: Point, tap: boolean): number[] {
  const g = ground(c);
  if (mode === 'line') {
    const h = hexUnder(c, world);
    return isLand(c.map, h) && g.owner[h] === g.me ? [h] : [];
  }
  if (mode === 'front') {
    const e = nearestEdge(c.map, c.radius, world, (x) => isBorderEdge(g, x));
    if (!e) return [];
    const enemy = g.owner[e.other] ?? -1;
    if (tap && enemy >= 0) {
      return borderSegment({ map: c.map, hexes: c.view.hexes }, g.me, enemy, e.hex);
    }
    return [e.hex];
  }
  const e = nearestEdge(
    c.map,
    c.radius,
    world,
    (x) => isLand(c.map, x.hex) && isLand(c.map, x.other),
  );
  if (!e) return [];
  if (c.front.length === 0) return [e.hex];
  const near = distanceTo(c.map, e.other, c.front) < distanceTo(c.map, e.hex, c.front);
  return [near ? e.other : e.hex];
}

/** Добавляет точки, пропуская повтор последней. */
export function addPoints(d: Draft, pts: readonly number[]): Draft {
  const points = [...d.points];
  for (const p of pts) if (points.at(-1) !== p) points.push(p);
  return points.length === d.points.length ? d : { ...d, points };
}

/** «Готово»: команда плана по точкам черновика. */
export function draftCommand(d: Draft): Command | null {
  if (d.points.length === 0) return null;
  if (d.mode === 'front') return { t: 'assignFront', armyId: d.armyId, points: d.points };
  if (d.mode === 'line') return { t: 'setDefenseLine', armyId: d.armyId, points: d.points };
  return { t: 'setOffensiveLine', armyId: d.armyId, points: d.points };
}

/** Гексы подсветки: линия между точками так, как её достроит sim, или сами точки. */
export function draftPath(c: DraftContext, d: Draft): readonly number[] {
  const gr = { map: c.map, hexes: c.view.hexes };
  const me = c.view.playerId;
  if (d.mode === 'front') return frontLinePath(gr, me, d.points) ?? d.points;
  if (d.mode === 'line') return defenseLinePath(gr, me, d.points) ?? d.points;
  return offensiveLinePath(gr, d.points) ?? d.points;
}
