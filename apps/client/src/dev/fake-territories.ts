// Только для /dev/map: фейковые государства, чтобы оценить рельеф
// под заливкой территорий. Настоящие слои 4–7 — этап 04; в игровой код модуль не идёт.
import { Container, Graphics } from 'pixi.js';

import {
  TERRAIN,
  hexFromId,
  hexId,
  inBounds,
  neighbor,
  neighbors,
  type Hex,
  type MapStatic,
} from '@hexfront/sim';

import type { DetailLevel } from '../render/camera.ts';
import { hexCenter, hexEdge, hexPolygon } from '../render/hex-geometry.ts';
import { mixWithWhite } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

const STATE_RADIUS = 6;
/** Государство «игрока» — остальные чужие (прозрачность alphaOwn/alphaOther). */
const OWN = 0;
/** Цвета палитры игроков для трёх государств: разные оттенки, как соседям при раскраске. */
const PLAYER_SLOTS = [0, 1, 2] as const;
/** Какие спавны карты занимают государства. */
const SPAWN_SLOTS = [0, 2, 4] as const;

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
  update(scale: number, level: DetailLevel): void;
  destroy(): void;
}

interface Owned {
  readonly h: Hex;
  readonly p: number;
}

/** Строит слой из трёх государств по токенам territory. */
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
  const container = new Container();
  container.addChild(fill, borders);

  return {
    container,
    update(scale, level) {
      fill.clear();
      for (const c of cells) {
        const center = hexCenter(c.h, radius);
        fill.poly(hexPolygon(center, radius)).fill({
          color: mixWithWhite(lineOf(c.p), tokens.territory.fillMix),
          alpha: c.p === OWN ? tokens.territory.alphaOwn : tokens.territory.alphaOther,
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
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
