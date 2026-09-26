// Фишка отряда (art/units.md, «Фишка отряда», CR-003): три варианта на выбор владельца —
// «HoI4» (полоса армии слева, столбики организации и снабжения внутри), «Батарейка» (фишка
// заполнена по организации, полоса армии сверху), «Значок» (квадрат цвета армии, заполненный по
// организации). Снабжение: треугольник — низкое, красный — истощение идёт. Размеры — px при
// масштабе карты 1, фишка масштабируется вместе с картой.
import { Container, Graphics, Text } from 'pixi.js';

import type { UnitType } from '@hexfront/sim';

import { formatSoldiers } from '../i18n/format.ts';
import { mixWithWhite } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Вариант фишки — переключатель в песочнице, пока владелец не выберет (CR-003). */
export type ChipStyle = 'hoi' | 'battery' | 'badge';
export const CHIP_STYLES: readonly ChipStyle[] = ['hoi', 'battery', 'badge'];

const H = 24;
const MIN_W = 44;
const PAD = 6;
const GLYPH = 14;
const GAP = 5;
const OUTLINE = 1.5;
const SELECT = 2;
const SELECT_SCALE = 1.08;
/** «HoI4»: полоса армии слева, два столбика справа (организация, снабжение). */
const BAND = 6;
const BAR_W = 4;
const BAR_GAP = 2;
const BAR_PAD = 3;
/** «Батарейка»: полоса армии сверху; незаполненная часть — цвет игрока, смешанный с белым. */
const TOP_BAND = 6;
const EMPTY_MIX = 0.7;
/** «Значок»: квадрат цвета армии, числа — в плашке цвета игрока справа. */
const BADGE = 24;
const HOLD_W = 10;
const WARN = 9;
const LABEL_PX = 12;
const INDEX_PX = 10;
const RETREAT_ALPHA = 0.6;
const BAR_BG_ALPHA = 0.35;
/** Пунктир фишки-призрака набора, px. */
const GHOST_DASH = 3;
/** Снабжение: ниже порога истощения (50 %) — низкое; ниже 75 % — жёлтое на столбике. */
const LOW_SUPPLY = 0.5;
const MID_SUPPLY = 0.75;

/** Что показывает фишка: владелец, армия, тип, солдаты и состояния из units.md. */
export interface ChipState {
  readonly style: ChipStyle;
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

/** Фишка: root двигает и масштабирует слой, внутри — сама фишка. */
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

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Цвет столбика снабжения: истощение — красный, ниже 75 % — жёлтый, иначе — зелёный. */
export function supplyColor(supply: number, starving: boolean): string {
  if (starving || supply < LOW_SUPPLY) return tokens.status.danger;
  return supply < MID_SUPPLY ? tokens.status.lowSupply : tokens.status.success;
}

// Вертикальный столбик: фон и заполнение снизу.
function vbar(g: Graphics, x: number, top: number, h: number, share: number, color: string): void {
  g.rect(x, top, BAR_W, h).fill({ color: tokens.ui.surface, alpha: BAR_BG_ALPHA });
  const f = h * clamp01(share);
  g.rect(x, top + h - f, BAR_W, f).fill(color);
}

// Треугольник снабжения в правом верхнем углу: жёлтый — низкое, красный — истощение идёт.
function supplyWarn(g: Graphics, s: ChipState, x: number, y: number): void {
  if (s.supply === null || (s.supply >= LOW_SUPPLY && !s.starving)) return;
  const color = s.starving ? tokens.status.danger : tokens.status.lowSupply;
  g.poly([x, y - WARN / 2, x + WARN / 2, y + WARN / 2, x - WARN / 2, y + WARN / 2])
    .fill(color)
    .stroke({ color: tokens.ui.surface, width: OUTLINE });
  g.moveTo(x, y - 1)
    .lineTo(x, y + 1.5)
    .stroke({ color: tokens.ui.surface, width: 1.5, cap: 'round' });
}

function frame(g: Graphics, s: ChipState, left: number, w: number): void {
  const top = -H / 2;
  if (s.selected) {
    g.roundRect(
      left - OUTLINE - SELECT / 2,
      top - OUTLINE - SELECT / 2,
      w + 2 * OUTLINE + SELECT,
      H + 2 * OUTLINE + SELECT,
      tokens.radius.chip + 2,
    ).stroke({ color: tokens.ui.ink, width: SELECT });
  }
  if (s.encircled) {
    g.roundRect(left - 4, top - 4, w + 8, H + 8, tokens.radius.chip + 4).stroke({
      color: tokens.status.encircled,
      width: 2,
    });
  }
  if (s.hold) g.rect(-HOLD_W / 2, H / 2 + 3, HOLD_W, 2).fill(tokens.ui.ink);
}

interface Parts {
  readonly g: Graphics;
  readonly label: Text;
  readonly index: Text;
}

// «HoI4»: полоса армии слева во всю высоту, столбики org и снабжения справа внутри фишки.
function drawHoi(p: Parts, s: ChipState): number {
  const bars = s.supply === null ? 1 : 2;
  const inner = BAND + PAD + GLYPH + GAP + p.label.width + GAP;
  const w = Math.max(MIN_W, Math.ceil((inner + bars * (BAR_W + BAR_GAP) + BAR_PAD) / 2) * 2);
  const left = -w / 2;
  const top = -H / 2;
  const { g } = p;
  g.roundRect(left, top, w, H, tokens.radius.chip)
    .fill(s.color)
    .stroke({ color: tokens.ui.surface, width: OUTLINE });
  g.roundRect(left, top, BAND + tokens.radius.chip, H, tokens.radius.chip).fill(s.army ?? s.color);
  g.rect(left + BAND, top, tokens.radius.chip, H).fill(s.color);
  glyph(g, s.type, left + BAND + PAD, top + (H - GLYPH) / 2, tokens.ui.surface);
  p.label.position.set(left + BAND + PAD + GLYPH + GAP, 0);
  const barTop = top + BAR_PAD;
  const barH = H - 2 * BAR_PAD;
  let x = left + w - BAR_PAD - BAR_W;
  if (s.supply !== null) {
    vbar(g, x, barTop, barH, s.supply, supplyColor(s.supply, s.starving));
    x -= BAR_W + BAR_GAP;
  }
  vbar(g, x, barTop, barH, s.org, tokens.status.success);
  return w;
}

// «Батарейка»: фишка заполняется цветом игрока по организации, пустая часть — светлая.
function drawBattery(p: Parts, s: ChipState): number {
  const w = Math.max(MIN_W, Math.ceil((PAD + GLYPH + GAP + p.label.width + PAD) / 2) * 2);
  const left = -w / 2;
  const top = -H / 2;
  const { g } = p;
  const r = tokens.radius.chip;
  const band = s.army ? TOP_BAND : 0;
  if (s.army) g.roundRect(left, top, w, H, r).fill(s.army);
  g.roundRect(left, top + band, w, H - band, r).fill(mixWithWhite(s.color, EMPTY_MIX));
  const f = w * clamp01(s.org);
  if (f > 0) g.roundRect(left, top + band, Math.max(f, 2 * r), H - band, r).fill(s.color);
  g.roundRect(left, top, w, H, r).stroke({ color: tokens.ui.surface, width: OUTLINE });
  glyph(g, s.type, left + PAD, top + (H - GLYPH) / 2 + 1, tokens.ui.ink);
  p.label.position.set(left + PAD + GLYPH + GAP, 1);
  return w;
}

// «Значок»: квадрат цвета армии, заполненный снизу по организации; числа — в плашке справа.
function drawBadge(p: Parts, s: ChipState): number {
  const pill = Math.ceil((PAD + p.label.width + PAD) / 2) * 2;
  const w = BADGE + pill;
  const left = -w / 2;
  const top = -H / 2;
  const { g } = p;
  const mark = s.army ?? s.color;
  g.roundRect(
    left + BADGE - tokens.radius.chip,
    top,
    pill + tokens.radius.chip,
    H,
    tokens.radius.chip,
  )
    .fill(s.color)
    .stroke({ color: tokens.ui.surface, width: OUTLINE });
  g.roundRect(left, top, BADGE, H, tokens.radius.chip).fill(mixWithWhite(mark, EMPTY_MIX));
  const f = H * clamp01(s.org);
  if (f > 0) g.rect(left, top + H - f, BADGE, f).fill(mark);
  g.roundRect(left, top, BADGE, H, tokens.radius.chip).stroke({
    color: tokens.ui.surface,
    width: OUTLINE,
  });
  glyph(g, s.type, left + (BADGE - GLYPH) / 2, top + (H - GLYPH) / 2, tokens.ui.surface);
  p.label.position.set(left + BADGE + PAD, 0);
  return w;
}

/** Создаёт фишку; перерисовка — только при смене состояния (раз в снимок), не каждый кадр. */
export function createChip(): Chip {
  const root = new Container();
  const body = new Container();
  root.addChild(body);
  const g = new Graphics();
  const style = { fontFamily: tokens.font.ui.family, fontWeight: '500' } as const;
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
  const parts: Parts = { g, label, index };
  return {
    root,
    draw(s) {
      label.text = formatSoldiers(s.soldiers);
      const battery = s.style === 'battery' && !s.ghost;
      label.style.fill = s.ghost ? s.color : battery ? tokens.ui.ink : tokens.ui.surface;
      // На «батарейке» число лежит и на тёмной, и на светлой части — белый ореол для контраста.
      label.style.stroke = { color: tokens.ui.surface, width: battery ? 3 : 0 };
      g.clear();
      let w: number;
      if (s.ghost) {
        w = Math.max(MIN_W, Math.ceil((PAD + GLYPH + GAP + label.width + PAD) / 2) * 2);
        dashedRect(g, -w / 2, -H / 2, w, H, s.color);
        glyph(g, s.type, -w / 2 + PAD, -H / 2 + (H - GLYPH) / 2, s.color);
        label.position.set(-w / 2 + PAD + GLYPH + GAP, 0);
      } else if (s.style === 'hoi') w = drawHoi(parts, s);
      else if (s.style === 'battery') w = drawBattery(parts, s);
      else w = drawBadge(parts, s);
      frame(g, s, -w / 2, w);
      supplyWarn(g, s, w / 2, -H / 2);
      index.text = s.count > 1 ? `×${s.count}` : '';
      index.position.set(w / 2 + 3, 0);
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
