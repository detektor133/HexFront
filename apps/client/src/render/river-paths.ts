// Реки хранятся рёбрами гексов; для сглаженной линии (style-guide, слой 3) рёбра собираются
// в цепочки по общим вершинам.
import type { Point } from './hex-geometry.ts';

type Segment = readonly [Point, Point];

// Вершины соседних гексов считаются в float с разным порядком операций — сравниваем с округлением.
const key = (p: Point): string => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;

/** Собирает рёбра в непрерывные ломаные; порядок цепочек стабилен для одинакового входа. */
export function chainSegments(segments: readonly Segment[]): Point[][] {
  const byVertex = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const p of [a, b]) byVertex.set(key(p), [...(byVertex.get(key(p)) ?? []), i]);
  });
  const used = new Set<number>();
  const walk = (start: Point, first: number): Point[] => {
    const path = [start];
    let at = start;
    let seg: number | undefined = first;
    while (seg !== undefined) {
      used.add(seg);
      const [a, b] = segments[seg] ?? [at, at];
      at = key(a) === key(at) ? b : a;
      path.push(at);
      seg = (byVertex.get(key(at)) ?? []).find((s) => !used.has(s));
    }
    return path;
  };
  const chains: Point[][] = [];
  // Сначала от концов (вершин с одним ребром), затем замкнутые петли.
  segments.forEach(([a, b], i) => {
    if (used.has(i)) return;
    const endA = (byVertex.get(key(a)) ?? []).length === 1;
    const endB = (byVertex.get(key(b)) ?? []).length === 1;
    if (endA || endB) chains.push(walk(endA ? a : b, i));
  });
  segments.forEach(([a], i) => {
    if (!used.has(i)) chains.push(walk(a, i));
  });
  return chains;
}
