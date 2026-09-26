// Фишка отряда (art/units.md, «Фишка отряда», CR-004): цвет по отношению (свои — зелёные, враги —
// красные), полоса цвета армии над фишкой, организация и снабжение — отдельными столбиками своих
// цветов (`chip.org`, `chip.supply`) с легендой в интерфейсе, треугольник при нехватке снабжения.
// Три варианта на выбор владельца: «Счётчик», «Шкала», «Значок». Размеры — px при масштабе
// карты 1, фишка масштабируется вместе с картой.
import { Container, Graphics, Text } from 'pixi.js';

import type { UnitType } from '@hexfront/sim';

import { formatSoldiers } from '../i18n/format.ts';
import { tokens } from '../theme/tokens.ts';

/** Вариант фишки — переключатель в песочнице, пока владелец не выберет (CR-004). */
export type ChipStyle = 'hoi' | 'battery' | 'badge';
export const CHIP_STYLES: readonly ChipStyle[] = ['hoi', 'battery', 'badge'];

const H = 26;
const SQUARE = 26;
const PAD = 6;
const MIN_PANEL = 38;
const GLYPH = 14;
const OUTLINE = 1.5;
const SELECT = 2;
const SELECT_SCALE = 1.08;
/** Полоса цвета армии над фишкой: высота и зазор. */
const STRIPE = 4;
const STRIPE_GAP = 2;
/** Столбики организации и снабжения на белой плашке. */
const BAR_H = 3;
const BAR_GAP = 1.5;
const BAR_BOTTOM = 4;
/** «Значок»: круг, кольца организации (внешнее) и снабжения (внутреннее). */
const BADGE_R = 13;
const RING = 3;
const HOLD_W = 10;
const WARN = 10;
const LABEL_PX = 12;
const INDEX_PX = 10;
const RETREAT_ALPHA = 0.6;
/** «Шкала»: заливка организации — светлый `chip.org`. */
const GAUGE_ALPHA = 0.35;
/** Пунктир фишки-призрака набора, px. */
const GHOST_DASH = 3;
/** Снабжение: ниже 50 % — истощение грозит (красный), ниже 75 % — жёлтый (04-roads-supply.md). */
const LOW_SUPPLY = 0.5;
const MID_SUPPLY = 0.75;

/** Что показывает фишка: отношение, армия, тип, солдаты и состояния из units.md. */
export interface ChipState {
  readonly style: ChipStyle;
  /** Цвет фишки по отношению к игроку (`relation`). */
  readonly color: string;
  /** Цвет армии; null — резерв или чужой отряд. */
  readonly army: string | null;
  readonly type: UnitType;
  readonly soldiers: number;
  /** Организация 0..1 (у призрака набора — прогресс набора). */
  readonly org: number;
  /** Снабжённость 0..1; null — чужой отряд (неизвестно). */
  readonly supply: number | null;
  /** Идёт истощение — отряд теряет солдат от нехватки снабжения. */
  readonly starving: boolean;
  readonly count: number;
  readonly selected: boolean;
  readonly retreating: boolean;
  readonly encircled: boolean;
  readonly hold: boolean;
  readonly ghost: boolean;
}

export interface Chip {
  readonly root: Container;
  draw(s: ChipState): void;
  /** Разрешение текста: при приближении его растеризуют заново, чтобы число было чётким. */
  setResolution(r: number): void;
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

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Цвет снабжения: истощение или ниже 50 % — красный, ниже 75 % — жёлтый, иначе — `chip.supply`. */
export function supplyColor(supply: number, starving: boolean): string {
  if (starving || supply < LOW_SUPPLY) return tokens.status.danger;
  return supply < MID_SUPPLY ? tokens.status.lowSupply : tokens.chip.supply;
}

function hbar(g: Graphics, x: number, y: number, w: number, share: number, color: string): void {
  g.roundRect(x, y, w, BAR_H, BAR_H / 2).fill(tokens.chip.track);
  const f = w * clamp01(share);
  if (f > 0) g.roundRect(x, y, Math.max(f, BAR_H), BAR_H, BAR_H / 2).fill(color);
}

// Треугольник снабжения в правом верхнем углу: жёлтый — мало, красный — идёт истощение.
function supplyWarn(g: Graphics, s: ChipState, x: number, y: number): void {
  if (s.supply === null || (s.supply >= LOW_SUPPLY && !s.starving)) return;
  const color = s.starving ? tokens.status.danger : tokens.status.lowSupply;
  g.poly([x, y - WARN / 2, x + WARN / 2, y + WARN / 2, x - WARN / 2, y + WARN / 2])
    .fill(color)
    .stroke({ color: tokens.ui.surface, width: OUTLINE });
  g.moveTo(x, y - 1.5)
    .lineTo(x, y + 1.5)
    .stroke({ color: tokens.ui.surface, width: 1.5, cap: 'round' });
}

// Общее для всех вариантов: полоса армии над фишкой, выбор, котёл, «держать».
function frame(g: Graphics, s: ChipState, left: number, w: number): void {
  const top = -H / 2;
  if (s.army) {
    g.roundRect(left, top - STRIPE_GAP - STRIPE, w, STRIPE, STRIPE / 2)
      .fill(s.army)
      .stroke({ color: tokens.ui.surface, width: 1 });
  }
  if (s.selected) {
    // Рамка выбора охватывает и полосу армии — полоса не прячется под рамкой.
    const up = s.army ? STRIPE + STRIPE_GAP : 0;
    g.roundRect(left - 3, top - 3 - up, w + 6, H + 6 + up, tokens.radius.chip + 2).stroke({
      color: tokens.ui.ink,
      width: SELECT,
    });
  }
  if (s.encircled) {
    g.roundRect(left - 5, top - 5, w + 10, H + 10, tokens.radius.chip + 4).stroke({
      color: tokens.status.encircled,
      width: 2,
    });
  }
  if (s.hold) g.rect(-HOLD_W / 2, H / 2 + 3, HOLD_W, 2).fill(tokens.ui.ink);
}

interface Parts {
  readonly g: Graphics;
  readonly label: Text;
}

// Квадрат цвета отношения с глифом слева.
function square(g: Graphics, s: ChipState, left: number, top: number): void {
  const r = tokens.radius.chip;
  g.roundRect(left, top, SQUARE, H, r).fill(s.color);
  g.rect(left + SQUARE - r, top, r, H).fill(s.color);
  glyph(g, s.type, left + (SQUARE - GLYPH) / 2, top + (H - GLYPH) / 2, tokens.ui.surface);
}

// «Счётчик»: квадрат с глифом, белая плашка — число и два столбика (орг., снабжение).
function drawCounter(p: Parts, s: ChipState): number {
  const panel = Math.max(MIN_PANEL, Math.ceil(p.label.width + 2 * PAD));
  const w = SQUARE + panel;
  const left = -w / 2;
  const top = -H / 2;
  const { g } = p;
  g.roundRect(left, top, w, H, tokens.radius.chip)
    .fill(tokens.ui.surface)
    .stroke({ color: s.color, width: OUTLINE });
  square(g, s, left, top);
  const x = left + SQUARE + PAD;
  const bw = panel - 2 * PAD;
  const y2 = H / 2 - BAR_BOTTOM - BAR_H;
  const y1 = y2 - BAR_GAP - BAR_H;
  if (s.supply === null) hbar(g, x, y2, bw, s.org, tokens.chip.org);
  else {
    hbar(g, x, y1, bw, s.org, tokens.chip.org);
    hbar(g, x, y2, bw, s.supply, supplyColor(s.supply, s.starving));
  }
  p.label.position.set(x + bw / 2, top + 8);
  return w;
}

// «Шкала»: плашка заполняется светлым цветом организации, число поверх; снизу — снабжение.
function drawGauge(p: Parts, s: ChipState): number {
  const panel = Math.max(MIN_PANEL, Math.ceil(p.label.width + 2 * PAD));
  const w = SQUARE + panel;
  const left = -w / 2;
  const top = -H / 2;
  const { g } = p;
  const r = tokens.radius.chip;
  g.roundRect(left, top, w, H, r).fill(tokens.ui.surface);
  const f = panel * clamp01(s.org);
  if (f > 0) g.rect(left + SQUARE, top, f, H).fill({ color: tokens.chip.org, alpha: GAUGE_ALPHA });
  if (s.supply !== null) {
    const sf = panel * clamp01(s.supply);
    g.rect(left + SQUARE, top + H - BAR_H - 1, sf, BAR_H).fill(supplyColor(s.supply, s.starving));
  }
  g.roundRect(left, top, w, H, r).stroke({ color: s.color, width: OUTLINE });
  square(g, s, left, top);
  p.label.position.set(left + SQUARE + panel / 2, -1);
  return w;
}

// «Значок»: круг цвета отношения с глифом; внешнее кольцо — организация, внутреннее — снабжение.
function drawBadge(p: Parts, s: ChipState): number {
  const pill = Math.max(30, Math.ceil(p.label.width + 2 * PAD));
  const w = 2 * BADGE_R + 4 + pill;
  const left = -w / 2;
  const cx = left + BADGE_R;
  const { g } = p;
  g.roundRect(cx, -9, BADGE_R + 4 + pill, 18, 9)
    .fill(tokens.ui.surface)
    .stroke({ color: s.color, width: OUTLINE });
  g.circle(cx, 0, BADGE_R).fill(s.color);
  const start = -Math.PI / 2;
  const ringR = BADGE_R - RING / 2;
  g.arc(cx, 0, ringR, start, start + 2 * Math.PI).stroke({ color: tokens.chip.track, width: RING });
  const org = clamp01(s.org);
  if (org > 0) {
    g.arc(cx, 0, ringR, start, start + 2 * Math.PI * org).stroke({
      color: tokens.chip.org,
      width: RING,
    });
  }
  if (s.supply !== null && s.supply > 0) {
    g.arc(cx, 0, ringR - RING - 1, start, start + 2 * Math.PI * clamp01(s.supply)).stroke({
      color: supplyColor(s.supply, s.starving),
      width: 2,
    });
  }
  glyph(g, s.type, cx - GLYPH / 2, -GLYPH / 2, tokens.ui.surface);
  p.label.position.set(cx + BADGE_R + 4 + pill / 2, 0);
  return w;
}

function drawGhost(p: Parts, s: ChipState): number {
  const w = Math.max(SQUARE + MIN_PANEL, Math.ceil(SQUARE + p.label.width + 2 * PAD));
  const left = -w / 2;
  const top = -H / 2;
  const { g } = p;
  for (let x = left; x < left + w; x += GHOST_DASH * 2) {
    const e = Math.min(x + GHOST_DASH, left + w);
    g.moveTo(x, top).lineTo(e, top);
    g.moveTo(x, top + H).lineTo(e, top + H);
  }
  g.moveTo(left, top).lineTo(left, top + H);
  g.moveTo(left + w, top).lineTo(left + w, top + H);
  g.stroke({ color: s.color, width: OUTLINE });
  glyph(g, s.type, left + (SQUARE - GLYPH) / 2, top + (H - GLYPH) / 2, s.color);
  hbar(g, left + SQUARE, H / 2 - BAR_BOTTOM - BAR_H, w - SQUARE - PAD, s.org, s.color);
  p.label.position.set(left + SQUARE + (w - SQUARE) / 2, top + 8);
  return w;
}

function drawBody(p: Parts, s: ChipState): number {
  if (s.ghost) return drawGhost(p, s);
  if (s.style === 'hoi') return drawCounter(p, s);
  return s.style === 'battery' ? drawGauge(p, s) : drawBadge(p, s);
}

/** Создаёт фишку; перерисовка — только при смене состояния (раз в снимок), не каждый кадр. */
export function createChip(): Chip {
  const root = new Container();
  const body = new Container();
  root.addChild(body);
  const g = new Graphics();
  const style = {
    fontFamily: tokens.font.ui.family,
    fontWeight: '600',
    fill: tokens.ui.ink,
  } as const;
  const label = new Text({ text: '', style: { ...style, fontSize: LABEL_PX } });
  const index = new Text({ text: '', style: { ...style, fontSize: INDEX_PX } });
  label.anchor.set(0.5, 0.5);
  index.anchor.set(0, 0.5);
  label.resolution = window.devicePixelRatio * 2;
  index.resolution = window.devicePixelRatio * 2;
  body.addChild(g, label, index);
  const parts: Parts = { g, label };
  return {
    root,
    draw(s) {
      label.text = formatSoldiers(s.soldiers);
      label.style.fill = s.ghost ? s.color : tokens.ui.ink;
      g.clear();
      const w = drawBody(parts, s);
      frame(g, s, -w / 2, w);
      supplyWarn(g, s, w / 2, -H / 2);
      index.text = s.count > 1 ? `×${s.count}` : '';
      index.position.set(w / 2 + 4, 0);
      body.alpha = s.retreating ? RETREAT_ALPHA : 1;
      body.scale.set(s.selected ? SELECT_SCALE : 1);
    },
    setResolution(r) {
      if (label.resolution === r) return;
      label.resolution = r;
      index.resolution = r;
    },
    destroy() {
      root.destroy({ children: true });
    },
  };
}
