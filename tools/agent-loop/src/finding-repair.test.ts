import { describe, expect, it } from 'vitest';

import { parseTestRepair } from './finding-repair.ts';

describe('машинный исход repair-spec', () => {
  it('различает зелёное исправление, дефект продукта и непроверяемый критерий', () => {
    expect(parseTestRepair('РЕМОНТ: ИСПРАВЛЕНО')).toEqual({ kind: 'fixed' });
    expect(parseTestRepair('РЕМОНТ: КОД — HUD переполняется')).toEqual({
      kind: 'code',
      detail: 'HUD переполняется',
    });
    expect(parseTestRepair('РЕМОНТ: НЕПРОВЕРЯЕМО — jsdom не считает CSS')).toEqual({
      kind: 'untestable',
      detail: 'jsdom не считает CSS',
    });
  });

  it('отклоняет свободный текст и исход без причины', () => {
    expect(parseTestRepair('Тест исправлен')).toBeUndefined();
    expect(parseTestRepair('РЕМОНТ: КОД')).toBeUndefined();
    expect(parseTestRepair('РЕМОНТ: НЕПРОВЕРЯЕМО')).toBeUndefined();
  });
});
