// Знаки на карте — те же иконки Tabler, что на кнопках строительства (HexCard): склад — коробка,
// укрепление — щит, город — замок, благоустройство — шевроны; столица — звезда. Без дисков:
// иконка цвета владельца с белой обводкой. Контуры рисуются в canvas один раз на вид и становятся
// белыми текстурами; цвет даёт тинт спрайта.
import { Container, Sprite, Texture } from 'pixi.js';

import type { Point } from '../render/hex-geometry.ts';

export type MapIconKind = 'city' | 'capital' | 'fort' | 'depot' | 'improvement';

export interface MapIcon {
  readonly kind: MapIconKind;
  readonly at: Point;
  /** Цвет иконки — цвет владельца; белая обводка рисуется под ней. */
  readonly color: string;
  /** Сторона квадрата иконки, мировые единицы. */
  readonly size: number;
}

/** Сторона иконки в радиусах знака: контур Tabler занимает ~3/4 своей рамки 24×24. */
export const ICON_FIT = 2.2;

/** Контуры Tabler (viewBox 24×24): Castle, Shield, Package, ChevronsUp; звезда — своя. */
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
  capital: ['M12 2l2.9 6.6l7.1 0.7l-5.4 4.7l1.6 7l-6.2 -3.7l-6.2 3.7l1.6 -7l-5.4 -4.7l7.1 -0.7z'],
  improvement: ['M7 11l5 -5l5 5', 'M7 17l5 -5l5 5'],
};

const TEXTURE_PX = 96;
const STROKE = 3;
const OUTLINE = 3.4;
const cache = new Map<string, Texture>();

// Две белые текстуры одной иконки: обводка (толще, звезда с заливкой) идёт под цветной иконкой.
function iconTexture(kind: MapIconKind, outline: boolean): Texture {
  const key = kind + (outline ? ':outline' : ':fill');
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_PX;
  canvas.height = TEXTURE_PX;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(TEXTURE_PX / 24, TEXTURE_PX / 24);
    ctx.strokeStyle = '#FFFFFF';
    ctx.fillStyle = '#FFFFFF';
    ctx.lineWidth = outline ? STROKE + OUTLINE : STROKE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const d of ICON_PATHS[kind]) {
      const path = new Path2D(d);
      if (kind === 'capital') ctx.fill(path);
      ctx.stroke(path);
    }
  }
  const texture = Texture.from(canvas);
  cache.set(key, texture);
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
  const place = (index: number, texture: Texture, icon: MapIcon, tint: string): void => {
    let sprite = pool[index];
    if (!sprite) {
      sprite = new Sprite();
      sprite.anchor.set(0.5);
      pool.push(sprite);
      container.addChild(sprite);
    }
    sprite.visible = true;
    sprite.texture = texture;
    sprite.tint = tint;
    sprite.position.set(icon.at.x, icon.at.y);
    sprite.width = icon.size;
    sprite.height = icon.size;
  };
  return {
    container,
    sync(icons) {
      if (typeof document === 'undefined') return;
      // Сначала все обводки, затем все цветные иконки: соседние знаки не затирают друг друга.
      icons.forEach((icon, i) => place(i, iconTexture(icon.kind, true), icon, '#FFFFFF'));
      icons.forEach((icon, i) =>
        place(icons.length + i, iconTexture(icon.kind, false), icon, icon.color),
      );
      for (let i = icons.length * 2; i < pool.length; i += 1) {
        const sprite = pool[i];
        if (sprite) sprite.visible = false;
      }
    },
  };
}
