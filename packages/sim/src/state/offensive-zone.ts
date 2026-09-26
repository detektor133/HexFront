// Зона наступления армии (CR-002, как в HoI4): гексы между участком фронта и линией наступления.
// Общая для offensiveSystem и снимка игрока (отрисовка зоны).
// GDD: docs/gdd/07-controls.md — «Линия наступления».
import type { LineGround } from './ground.ts';
import { TERRAIN } from '../map/types.ts';
import { distance, hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';

/** Запас ширины зоны веером, гексов (07-controls.md, «Линия наступления»). */
const ZONE_SLACK = 2;

function adjacent(state: LineGround, hex: HexId): HexId[] {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width))
    .filter((n) => inBounds(n, width, height))
    .map((n) => hexId(n, width));
}

function nearest(state: LineGround, hex: HexId, to: readonly HexId[]): number {
  const { width } = state.map;
  const h = hexFromId(hex, width);
  let best = Number.MAX_SAFE_INTEGER;
  for (const t of to) best = Math.min(best, distance(h, hexFromId(t, width)));
  return best;
}

/**
 * Зона наступления: чужие и ничьи проходимые гексы, до которых можно дойти от участка фронта,
 * не переходя линию наступления (гексы линии входят в зону, но за них заливка не идёт).
 * Гекс не дальше от фронта, чем самая дальняя точка линии (D), и ds + dt ≤ D + 2 — ширина веером.
 * @returns расстояние до линии наступления для каждого гекса зоны
 */
export function offensiveZone(
  state: LineGround,
  owner: number,
  front: readonly HexId[],
  line: readonly HexId[],
): Map<HexId, number> {
  const zone = new Map<HexId, number>();
  if (front.length === 0 || line.length === 0) return zone;
  const onLine = new Set(line);
  const farthest = Math.max(...line.map((h) => nearest(state, h, front)));
  const queue: HexId[] = [];
  const visit = (from: HexId): void => {
    for (const n of adjacent(state, from)) {
      if (zone.has(n) || state.hexes.owner[n] === owner) continue;
      if (state.map.terrain[n] === TERRAIN.water) continue;
      const ds = nearest(state, n, front);
      const dt = nearest(state, n, line);
      if (ds > farthest || ds + dt > farthest + ZONE_SLACK) continue;
      zone.set(n, dt);
      if (!onLine.has(n)) queue.push(n);
    }
  };
  // Фронт, уже стоящий на линии, не источник: иначе заливка ушла бы за линию.
  for (const f of front) if (!onLine.has(f)) visit(f);
  for (let i = 0; i < queue.length; i += 1) visit(queue[i] as HexId);
  return zone;
}
