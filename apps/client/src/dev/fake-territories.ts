// Только для /dev/map: фейковые государства и дорога-«метро», чтобы оценить палитру рельефа
// под заливкой территорий. Настоящие слои 4–7 — этап 04; в игровой код модуль не идёт.
import { Container, Graphics } from 'pixi.js';

import {
  TERRAIN,
  hexFromId,
  hexId,
  inBounds,
  line,
  neighbor,
  neighbors,
  type Hex,
  type MapStatic,
} from '@hexfront/sim';

import type { DetailLevel } from '../render/camera.ts';
import { hexCenter, hexEdge, hexPolygon } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const STATE_RADIUS = 6;
/** Цвета палитры игроков для трёх государств: разные оттенки, как соседям при раскраске. */
const PLAYER_SLOTS = [0, 1, 2] as const;
/** Какие спавны карты занимают государства. */
const SPAWN_SLOTS = [0, 2, 4] as const;

/** Смешивает цвет с белым: f — доля белого (territory.fillMix). */
export function mixWithWhite(hex: string, f: number): string {
  const ch = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `#${ch
    .map((c) =>
      Math.round(c * (1 - f) + 255 * f)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function claim(map: MapStatic): Int16Array {
  const owner = new Int16Array(map.width * map.height).fill(-1);
  const frontier: { h: Hex; p: number; d: number }[] = [];
  SPAWN_SLOTS.forEach((s, p) => {
    const spawn = map.spawns[s];
    if (spawn) frontier.push({ h: spawn, p, d: 0 });
  });
  // Поиск в ширину по суше от всех столиц сразу: границы ложатся посередине.
  while (frontier.length > 0) {
    const { h, p, d } = frontier.shift() as { h: Hex; p: number; d: number };
    const id = hexId(h, map.width);
    if (owner[id] !== -1 || map.terrain[id] === TERRAIN.water) continue;
    owner[id] = p;
    if (d >= STATE_RADIUS) continue;
    for (const n of neighbors(h)) {
      if (inBounds(n, map.width, map.height)) frontier.push({ h: n, p, d: d + 1 });
    }
  }
  return owner;
}

export interface FakeTerritories {
  readonly container: Container;
  update(scale: number, level: DetailLevel, alpha: number): void;
  destroy(): void;
}

interface Owned {
  readonly h: Hex;
  readonly p: number;
}

/** Строит слой из трёх государств и одной дороги по текущим токенам territory и road. */
export function createFakeTerritories(map: MapStatic, radius: number): FakeTerritories {
  const owner = claim(map);
  const cells: Owned[] = [];
  owner.forEach((p, id) => {
    if (p < 0) return;
    cells.push({ h: hexFromId(id, map.width), p });
  });
  const lineOf = (p: number): string =>
    tokens.players.palette[PLAYER_SLOTS[p] ?? 0]?.line ?? tokens.neutral.line;
  const ownerAt = (h: Hex): number =>
    inBounds(h, map.width, map.height) ? (owner[hexId(h, map.width)] ?? -1) : -1;

  const fill = new Graphics();
  const borders = new Graphics();
  const road = new Graphics();
  const container = new Container();
  container.addChild(fill, borders, road);

  const spawn = map.spawns[SPAWN_SLOTS[0]];
  const far = cells.filter((c) => c.p === 0).at(-1);
  const roadPath = spawn && far ? line(spawn, far.h).map((h) => hexCenter(h, radius)) : [];

  return {
    container,
    update(scale, level, alpha) {
      fill.clear();
      for (const c of cells) {
        const center = hexCenter(c.h, radius);
        fill.poly(hexPolygon(center, radius)).fill({
          color: mixWithWhite(lineOf(c.p), tokens.territory.fillMix),
          alpha,
        });
      }
      // Граница — внутренняя кромка цвета владельца (style-guide, слой 5).
      const bw =
        (tokens.territory.borderWidth[level - 1] ?? tokens.territory.borderWidth[1]) / scale;
      borders.clear();
      for (const p of [0, 1, 2]) {
        for (const c of cells.filter((x) => x.p === p)) {
          const center = hexCenter(c.h, radius);
          for (const d of [0, 1, 2, 3, 4, 5] as const) {
            if (ownerAt(neighbor(c.h, d)) === p) continue;
            const inset = (radius - bw / 2) / radius;
            const [va, vb] = hexEdge(center, radius * inset, d);
            borders.moveTo(va.x, va.y).lineTo(vb.x, vb.y);
          }
        }
        borders.stroke({ color: lineOf(p), width: bw, cap: 'round' });
      }
      road.clear();
      const [first, ...rest] = roadPath;
      if (first) {
        road.moveTo(first.x, first.y);
        for (const pt of rest) road.lineTo(pt.x, pt.y);
        const rw = tokens.road.width[level - 1] ?? tokens.road.width[1];
        road.stroke({ color: lineOf(0), width: rw / scale, cap: 'round', join: 'round' });
      }
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
