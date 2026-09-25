// Фишка отряда по docs/art/units.md, «Фишка отряда»: размеры в экранных px, контейнер
// масштабируется на 1 / масштаб камеры. Песочница 03/T17; эталонные скриншоты — этап 04.
import { Container, Graphics, Text } from 'pixi.js';

import type { UnitType } from '@hexfront/sim';

import { formatSoldiers } from '../i18n/format.ts';
import { tokens } from '../theme/tokens.ts';

const H = 24;
const MIN_W = 44;
const PAD_L = 6;
const GLYPH = 14;
const GAP = 5;
const PAD_R = 8;
const GLYPH_TOP = 5;
const OUTLINE = 1.5;
const SELECT = 2;
const SELECT_SCALE = 1.08;
const ORG_H = 2;
const ORG_GAP = 2;
const HOLD_W = 10;
const DOT_R = 3;
const LABEL_PX = 12;
const INDEX_PX = 10;
const RETREAT_ALPHA = 0.6;
const ORG_BG_ALPHA = 0.3;
/** Пунктир фишки-призрака набора, px. */
const GHOST_DASH = 3;

/** Что показывает фишка: владелец, тип, солдаты и состояния из units.md. */
export interface ChipState {
  readonly color: string;
  readonly type: UnitType;
  readonly soldiers: number;
  /** Доля 0..1 для полоски: организованность (или прогресс набора у призрака). */
  readonly bar: number;
  readonly count: number;
  readonly selected: boolean;
  readonly retreating: boolean;
  readonly encircled: boolean;
  readonly lowSupply: boolean;
  readonly hold: boolean;
  readonly ghost: boolean;
}

/** Фишка: root двигает и масштабирует слой (1 / масштаб камеры), внутри — сама фишка. */
export interface Chip {
  readonly root: Container;
  draw(s: ChipState): void;
  destroy(): void;
}

// Глифы 14×14, stroke 2, round (units.md, «Глифы»).
function glyph(g: Graphics, type: UnitType, x: number, y: number, color: string): void {
  const stroke = { color, width: 2, cap: 'round', join: 'round' } as const;
  if (type === 'infantry') {
    g.moveTo(x + 2, y + 10)
      .lineTo(x + 7, y + 5)
      .lineTo(x + 12, y + 10)
      .stroke(stroke);
  } else if (type === 'armor') {
    g.poly([x + 7, y + 2, x + 12, y + 7, x + 7, y + 12, x + 2, y + 7]).stroke(stroke);
  } else {
    g.arc(x + 7, y + 10, 5, Math.PI, 0).stroke(stroke);
    g.circle(x + 7, y + 10, 1.75).fill(color);
  }
}

function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, color: string): void {
  const sides: [number, number, number, number][] = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h],
    [x, y + h, x, y],
  ];
  for (const [ax, ay, bx, by] of sides) {
    const len = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t < len; t += GHOST_DASH * 2) {
      const e = Math.min(len, t + GHOST_DASH);
      g.moveTo(ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len);
      g.lineTo(ax + ((bx - ax) * e) / len, ay + ((by - ay) * e) / len);
    }
  }
  g.stroke({ color, width: OUTLINE });
}

// Отметки состояний под и над фишкой: полоска org, «держать», снабжение, котёл.
function marks(g: Graphics, s: ChipState, w: number): void {
  const left = -w / 2;
  const top = -H / 2;
  const barY = H / 2 + ORG_GAP;
  g.rect(left, barY, w, ORG_H).fill({ color: tokens.ui.surface, alpha: ORG_BG_ALPHA });
  g.rect(left, barY, w * Math.max(0, Math.min(1, s.bar)), ORG_H).fill(s.color);
  if (s.hold) g.rect(-HOLD_W / 2, barY + ORG_H + ORG_GAP, HOLD_W, 2).fill(tokens.ui.ink);
  if (s.encircled) {
    g.roundRect(left - 4, top - 4, w + 8, H + 8, tokens.radius.chip + 4).stroke({
      color: tokens.status.encircled,
      width: 2,
    });
  }
  if (s.encircled || s.lowSupply) {
    g.circle(w / 2, top, DOT_R)
      .fill(s.encircled ? tokens.status.encircled : tokens.status.lowSupply)
      .stroke({ color: tokens.ui.surface, width: OUTLINE });
  }
}

/** Создаёт фишку; перерисовка — только при смене состояния (раз в снимок), не каждый кадр. */
export function createChip(): Chip {
  const root = new Container();
  const body = new Container();
  root.addChild(body);
  const g = new Graphics();
  const style = {
    fontFamily: tokens.font.ui.family,
    fontWeight: '500',
    fill: tokens.ui.surface,
  } as const;
  const label = new Text({ text: '', style: { ...style, fontSize: LABEL_PX } });
  const index = new Text({
    text: '',
    style: { ...style, fontSize: INDEX_PX, fill: tokens.ui.ink },
  });
  label.anchor.set(0, 0.5);
  index.anchor.set(0, 0.5);
  label.resolution = window.devicePixelRatio * 2;
  index.resolution = window.devicePixelRatio * 2;
  body.addChild(g, label, index);
  return {
    root,
    draw(s) {
      label.text = formatSoldiers(s.soldiers);
      label.style.fill = s.ghost ? s.color : tokens.ui.surface;
      const raw = PAD_L + GLYPH + GAP + label.width + PAD_R;
      const w = Math.max(MIN_W, Math.ceil(raw / 2) * 2);
      const left = -w / 2;
      const top = -H / 2;
      g.clear();
      if (s.selected) {
        g.roundRect(
          left - OUTLINE - SELECT / 2,
          top - OUTLINE - SELECT / 2,
          w + 2 * OUTLINE + SELECT,
          H + 2 * OUTLINE + SELECT,
          tokens.radius.chip + 2,
        ).stroke({ color: tokens.ui.ink, width: SELECT });
      }
      if (s.ghost) dashedRect(g, left, top, w, H, s.color);
      else {
        g.roundRect(left, top, w, H, tokens.radius.chip)
          .fill(s.color)
          .stroke({ color: tokens.ui.surface, width: OUTLINE });
      }
      glyph(g, s.type, left + PAD_L, top + GLYPH_TOP, s.ghost ? s.color : tokens.ui.surface);
      marks(g, s, w);
      label.position.set(left + PAD_L + GLYPH + GAP, 0);
      index.text = s.count > 1 ? `×${s.count}` : '';
      index.position.set(w / 2 + 3, 0);
      body.alpha = s.retreating ? RETREAT_ALPHA : 1;
      body.scale.set(s.selected ? SELECT_SCALE : 1);
    },
    destroy() {
      root.destroy({ children: true });
    },
  };
}
