import { describe, expect, it } from 'vitest';

import { touchTapKind } from '../src/input/touch-tap.ts';

const phone = { coarse: true, selectedUnits: 3, modal: false, ownChip: false };

describe('тап на телефоне', () => {
  it('с выбранными отрядами тап по карте — приказ', () => {
    expect(touchTapKind('select', phone)).toBe('order');
  });

  it('без выбранных отрядов тап — обычный выбор и меню земли', () => {
    expect(touchTapKind('select', { ...phone, selectedUnits: 0 })).toBe('select');
  });

  it('стройка, вторжение и инструменты — как ЛКМ', () => {
    expect(touchTapKind('select', { ...phone, modal: true })).toBe('select');
  });

  it('тап по своей фишке выбирает её, а не отдаёт приказ', () => {
    expect(touchTapKind('select', { ...phone, ownChip: true })).toBe('select');
  });

  it('на ПК (мышь) ничего не меняется', () => {
    expect(touchTapKind('select', { ...phone, coarse: false })).toBe('select');
    expect(touchTapKind('order', phone)).toBe('order');
  });
});
