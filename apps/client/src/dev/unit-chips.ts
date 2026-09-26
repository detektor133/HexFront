// Фишка отряда (art/units.md, «Фишка отряда», CR-005). Всё — внутри прямоугольника фишки:
// слева закладка цвета армии, квадрат цвета отношения (свои — зелёные, враги — красные) с глифом
// рода войск, в его углу — число отрядов в стопке; справа на белой плашке — число солдат и два
// вертикальных столбика: организация `chip.org` и снабжение `chip.supply` (жёлтый/красный при
// нехватке). Выбранная фишка — золотая рамка `selection` по краю. Размеры — px при масштабе 1.
import { Container, Graphics, Text } from 'pixi.js';

import type { UnitType } from '@hexfront/sim';

import { formatSoldiers } from '../i18n/format.ts';
import { tokens } from '../theme/tokens.ts';

const H = 26;
const TAB = 6;
const SQUARE = 24;
const PAD = 5;
const MIN_TEXT = 22;
/** Запас ширины числа: ширину текста меряют и до загрузки шрифта Golos, он шире запасного. */
const TEXT_SLACK = 4;
const GLYPH = 14;
const OUTLINE = 1.5;
const SELECT_SCALE = 1.06;
/** Вертикальные столбики: ширина, зазор, отступ от края плашки. */
const BAR_W = 4;
const BAR_GAP = 2;
const BAR_INSET = 4;
/** Цифра стопки: кружок в правом нижнем углу квадрата. */
const COUNT_R = 5;
const COUNT_PX = 8;
/** Треугольник нехватки снабжения в правом верхнем углу квадрата. */
const WARN = 8;
const HOLD_W = 9;
const LABEL_PX = 12;
const RETREAT_ALPHA = 0.6;
/** Пунктир фишки-призрака набора, px. */
const GHOST_DASH = 3;
/** Снабжение: ниже 50 % — истощение грозит (красный), ниже 75 % — жёлтый (04-roads-supply.md). */
const LOW_SUPPLY = 0.5;
const MID_SUPPLY = 0.75;

/** Что показывает фишка: отношение, армия, тип, солдаты и состояния из units.md. */
export interface ChipState {
  /** Цвет фишки по отношению к игроку (`relation`). */
  readonly color: string;
  /** Цвет армии (закладка слева); null — резерв или чужой отряд. */
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

// Вертикальный столбик: подложка и заполнение снизу.
function vbar(g: Graphics, x: number, top: number, h: number, share: number, color: string): void {
  g.roundRect(x, top, BAR_W, h, BAR_W / 2).fill(tokens.chip.track);
  const f = h * clamp01(share);
  if (f > 0) g.roundRect(x, top + h - f, BAR_W, Math.max(f, BAR_W), BAR_W / 2).fill(color);
}

interface Parts {
  readonly g: Graphics;
  readonly label: Text;
  readonly count: Text;
}

function barsWidth(s: ChipState): number {
  return (s.supply === null ? 1 : 2) * (BAR_W + BAR_GAP) - BAR_GAP + BAR_INSET;
}

// Корпус: белая плашка с обводкой (золото — выбрано, красная — котёл), закладка армии, квадрат.
function body(g: Graphics, s: ChipState, left: number, w: number): number {
  const top = -H / 2;
  const r = tokens.radius.chip;
  const border = s.selected
    ? { color: tokens.selection.color, width: tokens.selection.width }
    : s.encircled
      ? { color: tokens.status.encircled, width: 2 }
      : { color: s.color, width: OUTLINE };
  g.roundRect(left, top, w, H, r).fill(tokens.ui.surface);
  // Закладка цвета армии — левый край фишки; без армии квадрат начинается от края.
  const tab = s.army ? TAB : 0;
  const sq = left + tab;
  if (s.army) {
    g.roundRect(left, top, TAB + r, H, r).fill(s.army);
    g.rect(sq, top, SQUARE, H).fill(s.color);
  } else {
    g.roundRect(sq, top, SQUARE, H, r).fill(s.color);
    g.rect(sq + r, top, SQUARE - r, H).fill(s.color);
  }
  g.roundRect(left, top, w, H, r).stroke(border);
  // Есть цифра стопки в углу — глиф чуть выше и левее, чтобы не перекрывался.
  const shift = s.count > 1 ? 2.5 : 0;
  glyph(
    g,
    s.type,
    sq + (SQUARE - GLYPH) / 2 - shift,
    top + (H - GLYPH) / 2 - shift,
    tokens.ui.surface,
  );
  return sq;
}

// Отметки внутри квадрата: стопка (цифра), нехватка снабжения (треугольник), «держать» (полоса).
function marks(p: Parts, s: ChipState, sq: number): void {
  const { g } = p;
  const top = -H / 2;
  const cx = sq + SQUARE - COUNT_R - 1;
  const cy = top + H - COUNT_R - 1;
  p.count.visible = s.count > 1;
  if (s.count > 1) {
    g.circle(cx, cy, COUNT_R).fill(tokens.ui.surface);
    p.count.text = String(s.count);
    p.count.position.set(cx, cy + 0.5);
  }
  if (s.supply !== null && (s.supply < LOW_SUPPLY || s.starving)) {
    const x = sq + SQUARE - WARN / 2 - 2;
    const y = top + WARN / 2 + 2;
    g.poly([x, y - WARN / 2, x + WARN / 2, y + WARN / 2, x - WARN / 2, y + WARN / 2])
      .fill(s.starving ? tokens.status.danger : tokens.status.lowSupply)
      .stroke({ color: tokens.ui.surface, width: 1 });
  }
  if (s.hold) g.rect(sq + 3, top + H - 4, HOLD_W, 2).fill(tokens.ui.surface);
}

function drawChip(p: Parts, s: ChipState): void {
  const text = Math.max(MIN_TEXT, Math.ceil(p.label.width) + TEXT_SLACK);
  const w = (s.army ? TAB : 0) + SQUARE + PAD + text + PAD + barsWidth(s);
  const left = -w / 2;
  const { g } = p;
  const sq = body(g, s, left, w);
  p.label.position.set(sq + SQUARE + PAD + text / 2, 0);
  const barTop = -H / 2 + 4;
  const barH = H - 8;
  let x = left + w - BAR_INSET - BAR_W;
  if (s.supply !== null) {
    vbar(g, x, barTop, barH, s.supply, supplyColor(s.supply, s.starving));
    x -= BAR_W + BAR_GAP;
  }
  vbar(g, x, barTop, barH, s.org, tokens.chip.org);
  marks(p, s, sq);
}

// Призрак набора в городе: пунктирный контур, глиф и столбик прогресса набора.
function drawGhost(p: Parts, s: ChipState): void {
  const text = Math.max(MIN_TEXT, Math.ceil(p.label.width));
  const w = SQUARE + PAD + text + PAD + BAR_W + BAR_INSET;
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
  vbar(g, left + w - BAR_INSET - BAR_W, top + 4, H - 8, s.org, s.color);
  p.label.position.set(left + SQUARE + PAD + text / 2, 0);
  p.count.visible = false;
}

/** Создаёт фишку; перерисовка — только при смене состояния (раз в снимок), не каждый кадр. */
export function createChip(): Chip {
  const root = new Container();
  const content = new Container();
  root.addChild(content);
  const g = new Graphics();
  const font = {
    fontFamily: tokens.font.ui.family,
    fontWeight: '600',
    fill: tokens.ui.ink,
  } as const;
  const label = new Text({ text: '', style: { ...font, fontSize: LABEL_PX } });
  const count = new Text({ text: '', style: { ...font, fontSize: COUNT_PX } });
  label.anchor.set(0.5, 0.5);
  count.anchor.set(0.5, 0.5);
  label.resolution = window.devicePixelRatio * 2;
  count.resolution = window.devicePixelRatio * 2;
  content.addChild(g, label, count);
  const parts: Parts = { g, label, count };
  return {
    root,
    draw(s) {
      label.text = formatSoldiers(s.soldiers);
      label.style.fill = s.ghost ? s.color : tokens.ui.ink;
      g.clear();
      if (s.ghost) drawGhost(parts, s);
      else drawChip(parts, s);
      content.alpha = s.retreating ? RETREAT_ALPHA : 1;
      content.scale.set(s.selected ? SELECT_SCALE : 1);
    },
    setResolution(r) {
      if (label.resolution === r) return;
      label.resolution = r;
      count.resolution = r;
    },
    destroy() {
      root.destroy({ children: true });
    },
  };
}
