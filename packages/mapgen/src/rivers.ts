// Реки как цепочки граней. Река идёт по границам гексов и должна быть связной линией: грани
// стыкуются в общих углах. Путь по центрам гексов даёт перпендикулярные грани, не касающиеся друг
// друга, — река «распадается»; здесь путь по гексам превращается в непрерывную цепочку граней.
import { neighbor, type Direction, type Hex } from '@hexfront/sim';

const squared = (x: number): number => x * x;

/** Угол — три попарно соседних гекса. */
type Corner = readonly [Hex, Hex, Hex];

const key = (h: Hex): string => `${h.q},${h.r}`;
const SQRT3 = Math.sqrt(3);

const sorted = (a: Hex, b: Hex, c: Hex): Corner =>
  [a, b, c].sort((x, y) => x.q - y.q || x.r - y.r) as unknown as Corner;

const cornerKey = (c: Corner): string => c.map(key).join('|');

// Центр гекса в плоскости (flat-top, радиус 1): угол — среднее центров своих трёх гексов.
const center = (h: Hex): { x: number; y: number } => ({
  x: 1.5 * h.q,
  y: SQRT3 * (h.r + h.q / 2),
});

function position(c: Corner): { x: number; y: number } {
  const [a, b, d] = c.map(center) as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  return { x: (a.x + b.x + d.x) / 3, y: (a.y + b.y + d.y) / 3 };
}

function directionOf(from: Hex, to: Hex): Direction | null {
  for (let d = 0; d < 6; d += 1) {
    const n = neighbor(from, d as Direction);
    if (n.q === to.q && n.r === to.r) return d as Direction;
  }
  return null;
}

/** Два общих угла соседних гексов a и b — концы их общей грани. */
function sharedCorners(a: Hex, b: Hex): [Corner, Corner] | null {
  const d = directionOf(a, b);
  if (d === null) return null;
  const c1 = neighbor(a, ((d + 1) % 6) as Direction);
  const c2 = neighbor(a, ((d + 5) % 6) as Direction);
  return [sorted(a, b, c1), sorted(a, b, c2)];
}

// Углы, до которых от угла одна грань: у каждой из трёх пар гексов угла — второй общий угол.
function cornerNeighbors(c: Corner): Corner[] {
  const out: Corner[] = [];
  for (let skip = 0; skip < 3; skip += 1) {
    const pair = c.filter((_, i) => i !== skip) as [Hex, Hex];
    const third = c[skip] as Hex;
    const shared = sharedCorners(pair[0], pair[1]);
    if (!shared) continue;
    out.push(cornerKey(shared[0]) === cornerKey(c) ? shared[1] : shared[0]);
    void third;
  }
  return out;
}

/** Грань между соседними гексами в формате карты: [q, r, 0–2] от меньшей из «прямых» сторон. */
export function edgeBetween(a: Hex, b: Hex): [number, number, number] | null {
  const d = directionOf(a, b);
  if (d === null) return null;
  return d < 3 ? [a.q, a.r, d] : [b.q, b.r, d - 3];
}

// Общая грань двух соседних углов: гексы, входящие в оба угла.
function edgeOfCorners(a: Corner, b: Corner): [number, number, number] | null {
  const inB = new Set(b.map(key));
  const common = a.filter((h) => inB.has(key(h)));
  if (common.length !== 2) return null;
  return edgeBetween(common[0] as Hex, common[1] as Hex);
}

// Кратчайший путь по углам (обход в ширину), не длиннее maxSteps граней.
function cornerPath(from: Corner, to: Corner, maxSteps: number): Corner[] | null {
  const target = cornerKey(to);
  const start = cornerKey(from);
  if (start === target) return [from];
  const prev = new Map<string, Corner | null>([[start, null]]);
  let frontier: Corner[] = [from];
  for (let step = 0; step < maxSteps; step += 1) {
    const next: Corner[] = [];
    for (const c of frontier) {
      for (const n of cornerNeighbors(c)) {
        const k = cornerKey(n);
        if (prev.has(k)) continue;
        prev.set(k, c);
        if (k === target) {
          const path: Corner[] = [n];
          for (let p = prev.get(k) ?? null; p; p = prev.get(cornerKey(p)) ?? null) path.push(p);
          return path.reverse();
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Превращает путь реки по соседним гексам в непрерывную цепочку граней: на каждом шаге река
 * проходит по одной из двух концов общей грани гексов — выбирается тот, что ближе к
 * предыдущему углу и с той же стороны от линии центров, чтобы цепочка не зигзагила поперёк.
 * @param path гексы реки по порядку, соседние попарно
 * @param inside допустим ли гекс (в границах карты)
 * @returns грани [q, r, 0–2] без повторов, стыкующиеся в общих углах
 */
export function riverFromHexPath(
  path: readonly Hex[],
  inside: (h: Hex) => boolean = () => true,
): [number, number, number][] {
  const edges: [number, number, number][] = [];
  const seen = new Set<string>();
  let previous: Corner | null = null;
  let side = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as Hex;
    const b = path[i] as Hex;
    const shared = sharedCorners(a, b);
    if (!shared || !inside(a) || !inside(b)) continue;
    const [c1, c2] = shared;
    // Сторона угла относительно направления a → b: знак векторного произведения.
    const pa = center(a);
    const pb = center(b);
    const crossOf = (c: Corner): number => {
      const p = position(c);
      return (pb.x - pa.x) * (p.y - pa.y) - (pb.y - pa.y) * (p.x - pa.x);
    };
    let chosen = c1;
    if (previous) {
      const p = position(previous);
      // sqrt от суммы квадратов, а не hypot: hypot в разных движках округляется по-разному, а карту
      // сервер и браузер обязаны построить одинаково.
      const d1 = Math.sqrt(squared(position(c1).x - p.x) + squared(position(c1).y - p.y));
      const d2 = Math.sqrt(squared(position(c2).x - p.x) + squared(position(c2).y - p.y));
      chosen = d1 < d2 - 1e-9 ? c1 : d2 < d1 - 1e-9 ? c2 : crossOf(c1) * side >= 0 ? c1 : c2;
    }
    side = crossOf(chosen) >= 0 ? 1 : -1;
    if (previous) {
      const way = cornerPath(previous, chosen, 4);
      for (let k = 1; way && k < way.length; k += 1) {
        const e = edgeOfCorners(way[k - 1] as Corner, way[k] as Corner);
        if (!e) continue;
        const first = { q: e[0], r: e[1] };
        if (!inside(first) || !inside(neighbor(first, e[2] as Direction))) continue;
        const id = `${e[0]},${e[1]},${e[2]}`;
        if (!seen.has(id)) {
          seen.add(id);
          edges.push(e);
        }
      }
    }
    previous = chosen;
  }
  return edges;
}
