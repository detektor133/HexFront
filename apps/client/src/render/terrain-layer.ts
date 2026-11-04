// Слои карты 1–3 (вода, рельеф с узорами, реки) и сетка гексов.
// Правила: docs/art/style-guide.md, «Слои карты»; цвета и толщины — tokens.json.
// Заливки, реки, сетка, берег и узоры рисует шейдер (terrain-gpu.ts); здесь — разделение слоёв
// на «под территорией» и «над территорией».
import { Container } from 'pixi.js';

import type { MapStatic } from '@hexfront/sim';

import type { DetailLevel } from './camera.ts';
import { createTerrainGpu } from './terrain-gpu.ts';

/** Детерминированное «случайное» число 0..1 от координат гекса и номера признака. */
export function hexNoise(q: number, r: number, salt: number): number {
  let h = Math.imul(q, 0x27d4eb2d) ^ Math.imul(r, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

export interface TerrainLayer {
  /** Заливки, реки и сетка — под территорией. */
  readonly base: Container;
  /** Узоры и берег — над территорией. */
  readonly overlay: Container;
  /** Масштаб и уровень детализации: экранные толщины линий. */
  update(scale: number, level: DetailLevel): void;
  destroy(): void;
}

/** Строит слои рельефа для карты при заданном радиусе гекса. */
export function createTerrainLayer(map: MapStatic, radius: number): TerrainLayer {
  const gpu = createTerrainGpu(map, radius);
  const base = new Container();
  base.addChild(gpu.base);
  const overlay = new Container();
  overlay.addChild(gpu.over);
  return {
    base,
    overlay,
    update: (scale, level) => gpu.setScale(scale, level),
    destroy() {
      gpu.destroy();
      base.destroy({ children: true, context: true });
      overlay.destroy({ children: true, context: true });
    },
  };
}
