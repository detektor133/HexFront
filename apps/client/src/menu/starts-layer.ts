// Столицы на карте за меню: цветные метки людей (своя крупнее и с кольцом) и серые метки ботов.
// Размер метки в экранных пикселях не зависит от масштаба карты.
import { Container, Graphics } from 'pixi.js';

import { hexFromId } from '@hexfront/sim';

import { hexCenter } from '../render/hex-geometry.ts';
import type { MidLayer } from '../render/map-view.ts';
import { tokens } from '../theme/tokens.ts';

export interface StartMarker {
  /** Гекс столицы. */
  readonly hex: number;
  /** Цвет игрока; у бота — нейтральный. */
  readonly color: string;
  /** Метка самого игрока: крупнее, с внешним кольцом. */
  readonly mine: boolean;
  /** Бот или живой человек: бот рисуется мельче и без обводки цветом. */
  readonly bot: boolean;
}

export interface StartsLayer extends MidLayer {
  setMarkers(markers: readonly StartMarker[]): void;
}

const MINE_PX = 11;
const HUMAN_PX = 8;
const BOT_PX = 5;

/** Слой меток; подключается как midLayer карты. */
export function createStartsLayer(
  map: { readonly width: number },
  radius: number,
  initial: readonly StartMarker[] = [],
): StartsLayer {
  const container = new Container();
  // Метки — над узорами рельефа (лес и горы не должны их закрывать).
  const top = new Container();
  const graphics = new Graphics();
  top.addChild(graphics);
  let markers = initial;
  let scale = 1;
  const draw = (): void => {
    graphics.clear();
    const k = 1 / scale;
    // Своя метка рисуется последней: чужие её не перекрывают.
    const ordered = [...markers].sort((a, b) => Number(a.mine) - Number(b.mine));
    for (const marker of ordered) {
      const at = hexCenter(hexFromId(marker.hex, map.width), radius);
      const size = (marker.mine ? MINE_PX : marker.bot ? BOT_PX : HUMAN_PX) * k;
      if (marker.mine) {
        graphics
          .circle(at.x, at.y, size + 6 * k)
          .stroke({ color: marker.color, width: 3 * k, alpha: 0.9 });
      }
      graphics
        .circle(at.x, at.y, size)
        .fill({ color: marker.bot ? tokens.ui.ink3 : marker.color })
        .stroke({ color: tokens.ui.surface, width: 2 * k });
    }
  };
  return {
    container,
    top,
    setMarkers(next) {
      markers = next;
      draw();
    },
    update(nextScale) {
      scale = nextScale;
      draw();
    },
    destroy() {
      top.destroy({ children: true, context: true });
      container.destroy({ children: true, context: true });
    },
  };
}
