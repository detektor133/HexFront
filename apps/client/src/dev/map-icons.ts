// Знаки на карте — те же иконки Tabler, что на кнопках строительства (HexCard): склад — коробка,
// укрепление — щит, город — замок, благоустройство — шевроны; столица — звезда. Без дисков:
// иконка цвета владельца с белой обводкой.
import { Container, Graphics, GraphicsContext, GraphicsPath } from 'pixi.js';

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

// Иконки — векторные: контуры Tabler рисуются Graphics в мировых единицах и перетесселируются
// видеокартой с MSAA, поэтому края острые при любом зуме (растровая текстура всегда «мылилась»).
const STROKE = 2.6;
const OUTLINE = 2.8;
/** Контекст на (вид, цвет, обводка) общий для всех иконок: геометрия строится один раз. */
const contexts = new Map<string, GraphicsContext>();

function iconContext(kind: MapIconKind, color: string, outline: boolean): GraphicsContext {
  const key = `${kind}:${color}:${outline ? 'o' : 'f'}`;
  const cached = contexts.get(key);
  if (cached) return cached;
  const context = new GraphicsContext();
  const width = outline ? STROKE + OUTLINE : STROKE;
  for (const d of ICON_PATHS[kind]) {
    const path = new GraphicsPath(d);
    // Звезда столицы закрашена: сплошной силуэт читается мельче линейных значков.
    if (kind === 'capital') context.path(path).fill({ color });
    context.path(path).stroke({ color, width, cap: 'round', join: 'round' });
  }
  contexts.set(key, context);
  return context;
}

export interface MapIconLayer {
  readonly container: Container;
  /** Расставляет иконки: лишние графики прячутся, недостающие создаются. */
  sync(icons: readonly MapIcon[]): void;
}

const WHITE = '#FFFFFF';

export function createMapIconLayer(): MapIconLayer {
  const container = new Container();
  const pool: Graphics[] = [];
  const place = (index: number, context: GraphicsContext, icon: MapIcon): void => {
    let g = pool[index];
    if (!g) {
      g = new Graphics();
      g.pivot.set(12, 12);
      pool.push(g);
      container.addChild(g);
    }
    g.visible = true;
    g.context = context;
    g.position.set(icon.at.x, icon.at.y);
    g.scale.set(icon.size / 24);
  };
  return {
    container,
    sync(icons) {
      // Сначала все обводки, затем все цветные иконки: соседние знаки не затирают друг друга.
      icons.forEach((icon, i) => place(i, iconContext(icon.kind, WHITE, true), icon));
      icons.forEach((icon, i) =>
        place(icons.length + i, iconContext(icon.kind, icon.color, false), icon),
      );
      for (let i = icons.length * 2; i < pool.length; i += 1) {
        const g = pool[i];
        if (g) g.visible = false;
      }
    },
  };
}
