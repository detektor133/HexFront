// Тап на сенсорном экране (07-controls.md, «Телефон»): с выбранными отрядами тап по карте — приказ
// (как ПКМ на ПК), потому что точно выбирать фишки пальцем неудобно, а армии выбираются карточками
// внизу. Режимы строительства, вторжения, «Держать» и инструменты, а также тап по своей фишке и
// тап без выбранных отрядов работают как ЛКМ.
import type { TapKind } from '../render/map-view.ts';

export interface TouchTapContext {
  /** Устройство с грубым указателем: палец, а не мышь. */
  readonly coarse: boolean;
  /** Сколько отрядов выбрано. */
  readonly selectedUnits: number;
  /** Включён режим, где тап — это нажатие ЛКМ: стройка, вторжение, инструмент плана. */
  readonly modal: boolean;
  /** Под пальцем фишка своего отряда. */
  readonly ownChip: boolean;
}

/** Вид тапа: на телефоне с выбранными отрядами — приказ, иначе обычный выбор. */
export function touchTapKind(kind: TapKind, ctx: TouchTapContext): TapKind {
  if (kind !== 'select' || !ctx.coarse) return kind;
  if (ctx.selectedUnits === 0 || ctx.modal || ctx.ownChip) return kind;
  return 'order';
}

/** Телефон или планшет: основной указатель — палец. */
export function isCoarsePointer(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}
