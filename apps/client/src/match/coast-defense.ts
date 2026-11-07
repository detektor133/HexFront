// Морская оборона из «Держать» (07-controls.md, «Панель армий»): пока армия ждёт цель «Держать»,
// свои гексы у моря подсвечены; два нажатия по ним (начало и конец участка) ставят армии линию
// обороны вдоль берега. Только ручной приказ: командир береговую линию сам не строит.
import {
  TERRAIN,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  waterNeighbors,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

/** Предел длины береговой линии, гексов. */
export const COAST_LINE_MAX = 40;

/** Свой гекс суши с соседней клеткой воды. */
export function isOwnCoast(view: PlayerView, map: MapStatic, hex: number): boolean {
  return (
    view.hexes.owner[hex] === view.playerId &&
    map.terrain[hex] !== TERRAIN.water &&
    waterNeighbors(map, hex).length > 0
  );
}

/** Все свои береговые гексы: подсвечиваются, пока ждём начало линии обороны. */
export function ownCoast(view: PlayerView, map: MapStatic): number[] {
  const out: number[] = [];
  view.hexes.owner.forEach((_, h) => {
    if (isOwnCoast(view, map, h)) out.push(h);
  });
  return out;
}

/**
 * Береговая линия между двумя гексами: кратчайший путь только по своим береговым гексам.
 * @returns гексы от a до b или null, если берег между ними разорван или длиннее предела
 */
export function coastPath(view: PlayerView, map: MapStatic, a: number, b: number): number[] | null {
  if (!isOwnCoast(view, map, a) || !isOwnCoast(view, map, b)) return null;
  const prev = new Map<number, number>([[a, -1]]);
  const queue = [a];
  for (let i = 0; i < queue.length; i += 1) {
    const h = queue[i] as number;
    if (h === b) break;
    for (const n of neighbors(hexFromId(h, map.width))) {
      if (!inBounds(n, map.width, map.height)) continue;
      const id = hexId(n, map.width);
      if (prev.has(id) || !isOwnCoast(view, map, id)) continue;
      prev.set(id, h);
      queue.push(id);
    }
  }
  if (!prev.has(b)) return null;
  const path: number[] = [];
  for (let at = b; at >= 0; at = prev.get(at) ?? -1) path.push(at);
  path.reverse();
  return path.length <= COAST_LINE_MAX ? path : null;
}
