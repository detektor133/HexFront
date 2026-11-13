// Метки союзников на карте: расходящиеся кольца цвета отправителя и знак вида метки.
import { Container, Graphics } from 'pixi.js';

import type { MarkKind } from '@hexfront/protocol';

import type { Point } from '../render/hex-geometry.ts';
import { playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Сколько метка живёт, мс, и размеры в экранных пикселях (не зависят от масштаба карты). */
const LIFE_MS = 8000;
const RING_COUNT = 3;
const RING_PERIOD_MS = 1600;
const RING_MAX_PX = 44;
const GLYPH_PX = 11;
const LINE_PX = 3;
const MAX_ACTIVE = 12;

interface Ping {
  readonly hex: number;
  readonly kind: MarkKind;
  readonly color: string;
  readonly started: number;
}

export interface PingLayer {
  readonly container: Container;
  /** Новая метка; `nowMs` — время кадра (performance.now()). */
  add(hex: number, kind: MarkKind, owner: number, nowMs: number): void;
  /** Постоянный маркер выбранного места старта; null — убрать. */
  setMarker(hex: number | null): void;
  /** Покадровая отрисовка; `scale` — масштаб карты, чтобы знак не менял экранный размер. */
  frame(nowMs: number, scale: number): void;
  destroy(): void;
}

// Углы правильного шестиугольника единичного радиуса: sin/cos в кадре не нужны.
const HEX_CORNERS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, 0.866],
  [-0.5, 0.866],
  [-1, 0],
  [-0.5, -0.866],
  [0.5, -0.866],
];

/** Знак метки: атака — крест, защита — шестиугольник, помощь — плюс, внимание — кольцо с точкой. */
function drawGlyph(
  g: Graphics,
  kind: MarkKind,
  at: Point,
  size: number,
  width: number,
  color: string,
): void {
  if (kind === 'attack') {
    g.moveTo(at.x - size, at.y - size).lineTo(at.x + size, at.y + size);
    g.moveTo(at.x + size, at.y - size).lineTo(at.x - size, at.y + size);
  } else if (kind === 'help') {
    g.moveTo(at.x - size, at.y).lineTo(at.x + size, at.y);
    g.moveTo(at.x, at.y - size).lineTo(at.x, at.y + size);
  } else if (kind === 'defend') {
    g.poly(
      HEX_CORNERS.flatMap(([x, y]) => [at.x + size * x, at.y + size * y]),
      true,
    );
  } else {
    g.circle(at.x, at.y, size);
  }
  g.stroke({ color, width, cap: 'round', join: 'round' });
  if (kind === 'look') g.circle(at.x, at.y, size * 0.3).fill({ color });
}

export function createPingLayer(center: (hex: number) => Point): PingLayer {
  const container = new Container();
  const graphics = new Graphics();
  container.addChild(graphics);
  let pings: Ping[] = [];
  let marker: number | null = null;

  return {
    container,
    add(hex, kind, owner, nowMs) {
      const color = playerLine(owner);
      pings = [...pings.filter((p) => p.hex !== hex), { hex, kind, color, started: nowMs }].slice(
        -MAX_ACTIVE,
      );
    },
    setMarker(hex) {
      marker = hex;
    },
    frame(nowMs, scale) {
      pings = pings.filter((p) => nowMs - p.started < LIFE_MS);
      graphics.clear();
      const k = 1 / scale;
      if (marker !== null) {
        const at = center(marker);
        graphics
          .circle(at.x, at.y, (GLYPH_PX + 7) * k)
          .fill({ color: tokens.ui.surface, alpha: 0.92 })
          .stroke({ color: tokens.ui.ink, width: 2.5 * k });
        graphics.circle(at.x, at.y, (GLYPH_PX - 4) * k).fill({ color: tokens.ui.ink });
      }
      for (const ping of pings) {
        const at = center(ping.hex);
        const age = nowMs - ping.started;
        const fade = Math.min(1, (LIFE_MS - age) / 1500);
        for (let i = 0; i < RING_COUNT; i += 1) {
          const t = ((age + (i * RING_PERIOD_MS) / RING_COUNT) % RING_PERIOD_MS) / RING_PERIOD_MS;
          graphics
            .circle(at.x, at.y, (GLYPH_PX + t * (RING_MAX_PX - GLYPH_PX)) * k)
            .stroke({ color: ping.color, width: 2 * k, alpha: (1 - t) * fade });
        }
        graphics
          .circle(at.x, at.y, (GLYPH_PX + 5) * k)
          .fill({ color: tokens.ui.surface, alpha: 0.9 * fade });
        drawGlyph(graphics, ping.kind, at, GLYPH_PX * k * 0.8, LINE_PX * k, ping.color);
      }
    },
    destroy() {
      container.destroy({ children: true, context: true });
    },
  };
}
