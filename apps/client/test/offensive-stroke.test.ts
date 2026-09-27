import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  cornerKey,
  cornerPath,
  edgeCorners,
  isLandEdge,
  loadMap,
  normalizeLine,
  type Corner,
  type EdgeId,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { finishCommand, startDraft, strokeAdd, type DraftContext } from '../src/dev/plan-draft.ts';
import { cornerPoint } from '../src/dev/plan-edges.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import type { Point } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
const R = tokens.map.hexRadius;

function start(): { map: MapStatic; view: PlayerView } {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const e = createLocalEngine(small, 42, 2);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  const msg = e.tick();
  if (msg.t !== 'view') throw new Error('ожидался снимок');
  return { map: loaded.map, view: msg.view };
}

// Расстояние от точки до отрезка ab.
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Углы цепочки граней по порядку от угла from.
function cornersAlong(c: DraftContext, from: Corner, edges: readonly EdgeId[]): Corner[] {
  const g = { map: c.map, hexes: c.view.hexes };
  const out = [from];
  for (const e of edges) {
    const at = cornerKey(g, out.at(-1) as Corner);
    const [a, b] = edgeCorners(e);
    out.push(cornerKey(g, a) === at ? b : a);
  }
  return out;
}

describe('линия наступления по пальцу (04/T14)', () => {
  const { map, view } = start();
  const c: DraftContext = { map, view, radius: R };
  const g = { map, hexes: view.hexes };
  const land = (e: EdgeId): boolean => isLandEdge(g, e);
  const capital = view.cities.find((x) => x.owner === view.playerId && x.isCapital)?.hex ?? -1;
  // Суша восточнее столицы (песочница, сид 42): диагональ на 4 столбца вправо и 4 гекса вверх.
  const from: Corner = { hex: capital + 2, a: 0 };
  const to: Corner = { hex: capital + 6 - 4 * map.width, a: 3 };
  const pf = cornerPoint(map, R, from);
  const pt = cornerPoint(map, R, to);

  it('быстрый диагональный росчерк даёт путь, ближайший к траектории', () => {
    const shortest = cornerPath(g, from, to, land) ?? [];
    expect(shortest.length).toBeGreaterThan(4);
    let d = strokeAdd(c, startDraft('offensive', 1), pf);
    d = strokeAdd(c, d, pt);
    expect(d.edges).toHaveLength(shortest.length);
    const corners = cornersAlong(c, from, d.edges);
    expect(cornerKey(g, corners.at(-1) as Corner)).toBe(cornerKey(g, to));
    // Лесенка вдоль диагонали: каждый угол пути — не дальше радиуса гекса от траектории.
    for (const k of corners)
      expect(toSegment(cornerPoint(map, R, k), pf, pt)).toBeLessThanOrEqual(R);
  });

  it('при равной близости к траектории путь выбирается одинаково (меньший EdgeId)', () => {
    const a = strokeAdd(c, strokeAdd(c, startDraft('offensive', 1), pf), pt);
    const b = strokeAdd(c, strokeAdd(c, startDraft('offensive', 1), pf), pt);
    expect(a.edges).toEqual(b.edges);
  });

  it('«вперёд 4 — назад 2»: возврат пальца стирает линию до этого места, без петель', () => {
    const path = cornerPath(g, from, { hex: capital + 6, a: 0 }, land) ?? [];
    expect(path.length).toBeGreaterThanOrEqual(8);
    const corners = cornersAlong(c, from, path);
    let d = startDraft('offensive', 1);
    for (const k of corners) d = strokeAdd(c, d, cornerPoint(map, R, k));
    expect(d.edges).toEqual(normalizeLine(g, path));
    const half = corners.length - 1 - Math.floor(path.length / 2);
    for (const k of corners.slice(half).reverse()) d = strokeAdd(c, d, cornerPoint(map, R, k));
    expect(d.edges).toEqual(normalizeLine(g, path.slice(0, half)));
    const keys = cornersAlong(c, from, d.edges).map((k) => cornerKey(g, k));
    expect(new Set(keys).size).toBe(keys.length);
    expect(finishCommand(d)).toEqual({ t: 'setOffensiveLine', armyId: 1, edges: d.edges });
  });
});
