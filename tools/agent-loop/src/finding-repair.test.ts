import { describe, expect, it } from 'vitest';

import { batchReviewFindings, parseTestRepair } from './finding-repair.ts';

describe('пакет возвратов review', () => {
  it('передаёт все замечания кодеру одним пакетом, тестовые — отдельным', () => {
    expect(
      batchReviewFindings([
        { kind: 'КОД', text: 'КОД: сломан HUD' },
        { kind: 'ТЕСТ', text: 'ТЕСТ: нет проверки края' },
        { kind: 'КОД', text: 'КОД: неверный формат' },
      ]),
    ).toEqual([
      { kind: 'КОД', text: '1. КОД: сломан HUD\n2. КОД: неверный формат' },
      { kind: 'ТЕСТ', text: 'ТЕСТ: нет проверки края' },
    ]);
  });

  it('не объединяет замечания разных владельцев', () => {
    expect(
      batchReviewFindings([
        { kind: 'ТЕСТ', text: 'ТЕСТ: неверное ожидание' },
        { kind: 'КОД', text: 'КОД: неверный результат' },
        { kind: 'ТЕСТ', text: 'ТЕСТ: отсутствует край' },
      ]),
    ).toEqual([
      { kind: 'ТЕСТ', text: '1. ТЕСТ: неверное ожидание\n2. ТЕСТ: отсутствует край' },
      { kind: 'КОД', text: 'КОД: неверный результат' },
    ]);
  });

  it('не оставляет повторно добавленный пункт отдельной работой', () => {
    expect(
      batchReviewFindings([
        { kind: 'КОД', text: 'КОД: причина уже исправлена' },
        { kind: 'ТЕСТ', text: 'ТЕСТ: старое ожидание' },
        { kind: 'КОД', text: 'КОД: причина уже исправлена' },
        { kind: 'КОД', text: 'КОД: второй дефект продукта' },
      ]),
    ).toEqual([
      {
        kind: 'КОД',
        text: '1. КОД: причина уже исправлена\n2. КОД: второй дефект продукта',
      },
      { kind: 'ТЕСТ', text: 'ТЕСТ: старое ожидание' },
    ]);
  });
});

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
