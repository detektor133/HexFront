import {
  FEATURE,
  TERRAIN,
  distance,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  type Hex,
} from '@hexfront/sim';

import type { MapOptions } from './terrain.ts';

interface RoadEdge {
  readonly a: number;
  readonly b: number;
  readonly weight: number;
}

const INF = 0x3fffffff;

function edgeKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

function roadWeight(terrain: Uint8Array, features: Uint8Array, id: number): number | null {
  const code = terrain[id] ?? TERRAIN.water;
  if (code === TERRAIN.water) return null;
  if (code === TERRAIN.mountains && features[id] !== FEATURE.pass) return null;
  if (features[id] === FEATURE.pass) return 3000;
  if (code === TERRAIN.plains || code === TERRAIN.forest || code === TERRAIN.hills) return 3000;
  if (code === TERRAIN.desert) return 2500;
  return null;
}

function shortestRoad(
  from: Hex,
  to: Hex,
  terrain: Uint8Array,
  features: Uint8Array,
  roads: Uint8Array,
  options: MapOptions,
): number[] | null {
  const start = hexId(from, options.width);
  const goal = hexId(to, options.width);
  const distances = new Int32Array(terrain.length).fill(INF);
  const previous = new Int32Array(terrain.length).fill(-1);
  const open: { id: number; cost: number }[] = [{ id: start, cost: 0 }];
  distances[start] = 0;
  while (open.length > 0) {
    open.sort((a, b) => a.cost - b.cost || a.id - b.id);
    const current = open.shift();
    if (!current) break;
    if (current.cost !== distances[current.id]) continue;
    if (current.id === goal) break;
    for (const next of neighbors(hexFromId(current.id, options.width))) {
      if (!inBounds(next, options.width, options.height)) continue;
      const nextId = hexId(next, options.width);
      const base = roadWeight(terrain, features, nextId);
      if (base === null) continue;
      const cost = roads[nextId] === 1 ? 1 : base;
      const nextCost = current.cost + cost;
      if (nextCost < (distances[nextId] ?? INF)) {
        distances[nextId] = nextCost;
        previous[nextId] = current.id;
        open.push({ id: nextId, cost: nextCost });
      }
    }
  }
  if (distances[goal] === INF) return null;
  const path: number[] = [];
  for (let id = goal; id >= 0; id = previous[id] ?? -1) {
    path.push(id);
    if (id === start) return path.reverse();
  }
  return null;
}

function allEdges(nodes: readonly Hex[]): RoadEdge[] {
  const edges: RoadEdge[] = [];
  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      const left = nodes[a];
      const right = nodes[b];
      if (!left || !right) continue;
      edges.push({ a, b, weight: distance(left, right) });
    }
  }
  return edges.sort(
    (left, right) => left.weight - right.weight || left.a - right.a || left.b - right.b,
  );
}

function triangulationEdges(nodes: readonly Hex[]): RoadEdge[] {
  const candidates = new Map<string, RoadEdge>();
  for (let a = 0; a < nodes.length; a += 1) {
    allEdges(nodes)
      .filter((edge) => edge.a === a || edge.b === a)
      .slice(0, 3)
      .forEach((edge) => candidates.set(edgeKey(edge.a, edge.b), edge));
  }
  return [...candidates.values()].sort(
    (left, right) => left.weight - right.weight || left.a - right.a || left.b - right.b,
  );
}

class DisjointSet {
  private readonly parents: number[];

  public constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, id) => id);
  }

  public find(value: number): number {
    let root = value;
    while (this.parents[root] !== root) root = this.parents[root] ?? root;
    while (this.parents[value] !== value) {
      const parent = this.parents[value] ?? value;
      this.parents[value] = root;
      value = parent;
    }
    return root;
  }

  public join(a: number, b: number): boolean {
    const left = this.find(a);
    const right = this.find(b);
    if (left === right) return false;
    this.parents[right] = left;
    return true;
  }
}

function addPath(
  edge: RoadEdge,
  nodes: readonly Hex[],
  terrain: Uint8Array,
  features: Uint8Array,
  roads: Uint8Array,
  options: MapOptions,
): boolean {
  const from = nodes[edge.a];
  const to = nodes[edge.b];
  if (!from || !to) return false;
  const path = shortestRoad(from, to, terrain, features, roads, options);
  if (!path) return false;
  path.forEach((id) => {
    roads[id] = 1;
  });
  return true;
}

export function generateRoads(
  terrain: Uint8Array,
  features: Uint8Array,
  nodes: readonly Hex[],
  options: MapOptions,
): Uint8Array {
  const roads = new Uint8Array(terrain.length);
  const disjoint = new DisjointSet(nodes.length);
  const selected = new Set<string>();
  const mst: RoadEdge[] = [];
  for (const edge of allEdges(nodes)) {
    if (disjoint.find(edge.a) === disjoint.find(edge.b)) continue;
    if (!addPath(edge, nodes, terrain, features, roads, options)) {
      continue;
    }
    disjoint.join(edge.a, edge.b);
    selected.add(edgeKey(edge.a, edge.b));
    mst.push(edge);
    if (mst.length === nodes.length - 1) break;
  }
  if (mst.length !== nodes.length - 1)
    throw new Error('генератор карты: дорожная сеть не связала все узлы');
  const extraCount = Math.max(1, Math.floor((mst.length + 4) / 5));
  let added = 0;
  for (const edge of triangulationEdges(nodes)) {
    if (selected.has(edgeKey(edge.a, edge.b))) continue;
    if (!addPath(edge, nodes, terrain, features, roads, options)) continue;
    selected.add(edgeKey(edge.a, edge.b));
    added += 1;
    if (added === extraCount) break;
  }
  return roads;
}
