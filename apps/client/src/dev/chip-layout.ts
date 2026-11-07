// Размеры и раскладка фишки отряда (art/units.md, «Фишка отряда»): одни и те же числа для
// рисования на процессоре (unit-chips.ts) и на GPU (chip-gpu.ts). Ширина фишки зависит от числа
// знаков в подписи, закладки, стрелки атаки и столбиков; считается целыми шагами по px фишки.
import type { UnitType } from '@hexfront/sim';

import { tokens } from '../theme/tokens.ts';

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
  readonly selected: boolean;
  readonly retreating: boolean;
  readonly encircled: boolean;
  readonly ghost: boolean;
  /** Направление к целевому соседнему гексу; null — приказа атаки нет. */
  readonly attackDirection?: number | null;
  /** Число одинаковых отрядов в стопке; нет или 1 — один отряд. */
  readonly count?: number;
  /** Звёзды опыта армии 0..3: столбик на закладке, видны и у чужих отрядов. */
  readonly stars?: number;
}

export const H = 26;
export const TAB = 6;
/** Закладка со звёздами опыта: шире обычной, звёзды стоят столбиком. */
export const TAB_STARS = 12;
export const STAR_R = 3.4;
export const STAR_STEP = 7.5;
export const SQUARE = 24;
export const PAD = 5;
export const MIN_TEXT = 22;
/** Запас ширины числа: ширину текста меряют и до загрузки шрифта Golos, он шире запасного. */
export const TEXT_SLACK = 4;
export const GLYPH = 14;
export const OUTLINE = 1.5;
/** Вертикальные столбики: ширина, зазор, отступ от края плашки. */
export const BAR_W = 4;
export const BAR_GAP = 2;
export const BAR_INSET = 4;
export const ATTACK_SLOT = 12;
export const ATTACK_ARROW = 10;
/** Треугольник нехватки снабжения в правом верхнем углу квадрата. */
export const WARN = 8;
export const LABEL_PX = 12;
export const COUNT_PX = 11;
export const COUNT_R = 8;
export const RETREAT_ALPHA = 0.6;
/** Пунктир фишки-призрака набора, px. */
export const GHOST_DASH = 3;
/** Снабжение: ниже 50 % — истощение грозит (красный), ниже 75 % — жёлтый (04-roads-supply.md). */
export const LOW_SUPPLY = 0.5;
export const MID_SUPPLY = 0.75;

/** Ширина закладки слева: цвет армии, а со звёздами — шире; чужой отряд со звёздами тоже с закладкой. */
export function tabWidth(s: ChipState): number {
  if ((s.stars ?? 0) > 0) return TAB_STARS;
  return s.army ? TAB : 0;
}

/** Ширина блока столбиков: два у своего отряда, один у чужого. */
export function barsWidth(s: ChipState): number {
  return (s.supply === null ? 1 : 2) * (BAR_W + BAR_GAP) - BAR_GAP + BAR_INSET;
}

/** Раскладка одной фишки в её px: ширина корпуса, закладка, центр подписи и ширина с рамкой. */
export interface ChipLayout {
  /** Ширина корпуса. */
  readonly w: number;
  /** Ширина закладки слева (в свёрнутой фишке — закладка армии). */
  readonly tab: number;
  /** Центр подписи по x от центра фишки. */
  readonly labelCx: number;
  /** Ширина для попадания и рамок: корпус с рамкой выбора; 0 у призрака набора. */
  readonly width: number;
}

const frame = (): number => Math.max(OUTLINE, tokens.selection.width, 2);

/**
 * Раскладка фишки по состоянию и числу знаков подписи.
 * @param labelLen длина текста числа солдат
 * @param compact фишка свёрнута в щит с числом
 */
export function chipLayout(s: ChipState, labelLen: number, compact: boolean): ChipLayout {
  if (s.ghost) {
    const text = Math.max(MIN_TEXT, labelLen * LABEL_PX);
    const w = SQUARE + PAD + text + PAD + BAR_W + BAR_INSET;
    return { w, tab: 0, labelCx: -w / 2 + SQUARE + PAD + text / 2, width: 0 };
  }
  const text = Math.max(MIN_TEXT, labelLen * LABEL_PX + TEXT_SLACK);
  if (compact) {
    const tab = s.army ? TAB : 0;
    const w = tab + text + PAD * 2;
    return { w, tab, labelCx: -w / 2 + tab + (w - tab) / 2, width: w + frame() };
  }
  const tab = tabWidth(s);
  const attackSlot =
    s.attackDirection === null || s.attackDirection === undefined ? 0 : ATTACK_SLOT;
  const w = tab + SQUARE + PAD + attackSlot + text + PAD + barsWidth(s);
  const sq = -w / 2 + tab;
  return { w, tab, labelCx: sq + SQUARE + PAD + attackSlot + text / 2, width: w + frame() };
}
