// Знаки зданий на карте — те же иконки Tabler, что на кнопках строительства (HexCard): склад —
// коробка, укрепление — щит, город — замок, благоустройство — шевроны. Контуры иконок рисуются
// в canvas один раз на вид и становятся текстурой белого цвета; диск цвета владельца под ней
// рисует Graphics.
import { Container, Sprite, Texture } from 'pixi.js';

import type { Point } from '../render/hex-geometry.ts';

export type MapIconKind = 'city' | 'fort' | 'depot' | 'improvement';

export interface MapIcon {
  readonly kind: MapIconKind;
  readonly at: Point;
  /** Сторона квадрата иконки, мировые единицы. */
  readonly size: number;
}

/** Доля стороны иконки от радиуса диска: контур Tabler занимает ~3/4 своей рамки 24×24. */
export const ICON_FIT = 1.8;

/** Контуры Tabler (viewBox 24×24): Castle, Shield, Package, ChevronsUp. */
const ICON_PATHS: Readonly<Record<MapIconKind, readonly string[]>> = {
  city: [
    'M15 19v-2a3 3 0 0 0 -6 0v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-14h4v3h3v-3h4v3h3v-3h4v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1',
    'M3 11l18 0',
  ],
  fort: ['M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3'],
  depot: [
    'M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5',
    'M12 12l8 -4.5',
    'M12 12l0 9',
    'M12 12l-8 -4.5',
    'M16 5.25l-8 4.5',
  ],
  improvement: ['M7 11l5 -5l5 5', 'M7 17l5 -5l5 5'],
};

const TEXTURE_PX = 96;
const STROKE = 2.6;
const cache = new Map<MapIconKind, Texture>();

function iconTexture(kind: MapIconKind): Texture {
  const cached = cache.get(kind);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_PX;
  canvas.height = TEXTURE_PX;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(TEXTURE_PX / 24, TEXTURE_PX / 24);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = STROKE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const d of ICON_PATHS[kind]) ctx.stroke(new Path2D(d));
  }
  const texture = Texture.from(canvas);
  cache.set(kind, texture);
  return texture;
}

export interface MapIconLayer {
  readonly container: Container;
  /** Расставляет иконки: лишние спрайты прячутся, недостающие создаются. */
  sync(icons: readonly MapIcon[]): void;
}

/** Без DOM (юнит-тесты в node) текстуры не строятся — слой пустой. */
export function createMapIconLayer(): MapIconLayer {
  const container = new Container();
  const pool: Sprite[] = [];
  return {
    container,
    sync(icons) {
      if (typeof document === 'undefined') return;
      icons.forEach((icon, i) => {
        let sprite = pool[i];
        if (!sprite) {
          sprite = new Sprite();
          sprite.anchor.set(0.5);
          pool.push(sprite);
          container.addChild(sprite);
        }
        sprite.visible = true;
        sprite.texture = iconTexture(icon.kind);
        sprite.position.set(icon.at.x, icon.at.y);
        sprite.width = icon.size;
        sprite.height = icon.size;
      });
      for (let i = icons.length; i < pool.length; i += 1) {
        const sprite = pool[i];
        if (sprite) sprite.visible = false;
      }
    },
  };
}
