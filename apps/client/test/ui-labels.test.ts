import { describe, expect, it } from 'vitest';

import { FP, type Fp } from '@hexfront/sim';

import { forecastBadge } from '../src/dev/forecast-plate.ts';
import { offensiveButtons } from '../src/dev/offensive-buttons.ts';
import { messages, type MessageKey } from '../src/i18n/dict.ts';
import { tokens } from '../src/theme/tokens.ts';

/** Подписи действий — одна иконка и подпись до двух слов (art/ui.md). */
const ACTIONS: readonly MessageKey[] = [
  'plan.front',
  'plan.line',
  'plan.offensive',
  'plan.erase',
  'plan.start',
  'plan.stop',
  'army.new',
  'army.disband',
  'army.reserve',
  'army.auto',
  'action.upgrade',
  'action.rebuild',
  'action.foundCity',
  'action.improve',
  'action.fort',
  'action.depot',
  'dev.economy.rebuild',
  'dev.economy.foundCity',
  'unit.merge',
  'unit.autoTarget',
  'unit.toArmy',
];

// Слово — кусок без пробелов, в котором есть буква, цифра или подстановка ({pop}).
const words = (text: string): number =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}{]/u.test(w)).length;

describe('подписи и причины отказа (04/T16, art/ui.md)', () => {
  for (const [lang, dict] of Object.entries(messages)) {
    it(`${lang}: подписи действий — не длиннее двух слов`, () => {
      const long = ACTIONS.filter((k) => words(dict[k]) > 2).map((k) => `${k}: ${dict[k]}`);
      expect(long).toEqual([]);
    });

    it(`${lang}: причины отказа — не длиннее 6 слов`, () => {
      const keys = (Object.keys(dict) as MessageKey[]).filter(
        (k) =>
          k.startsWith('reason.') ||
          [
            'plan.needFront',
            'plan.needWholeArmy',
            'plan.nothingToErase',
            'found.popTooLow',
          ].includes(k),
      );
      const long = keys.filter((k) => words(dict[k]) > 6).map((k) => `${k}: ${dict[k]}`);
      expect(long).toEqual([]);
    });
  }

  it('подсказок-инструкций и кнопок подтверждения атаки в словаре нет', () => {
    for (const k of [
      'unit.hintOrder',
      'unit.split',
      'unit.clear',
      'forecast.attack',
      'forecast.cancel',
      'plan.pause',
    ]) {
      expect(Object.keys(messages.ru)).not.toContain(k);
    }
  });
});

describe('плашка прогноза без слов (04/T16, art/units.md)', () => {
  it('иконка и цвет исхода + свои потери «−28 %», без букв', () => {
    const f = (outcome: 'victory' | 'stalemate' | 'defeat', loss: number) =>
      forecastBadge({
        outcome,
        attackerLoss: Math.round(loss * FP) as Fp,
        defenderLoss: 0 as Fp,
        timeS: 0 as Fp,
        attack: 0,
        defense: 0,
      });
    expect(f('victory', 0.12)).toMatchObject({ icon: 'victory', color: tokens.status.success });
    expect(f('stalemate', 0.4)).toMatchObject({ icon: 'stalemate', color: tokens.status.warning });
    expect(f('defeat', 0.28)).toMatchObject({ icon: 'defeat', color: tokens.status.danger });
    const text = f('defeat', 0.28).text;
    expect(text).toMatch(/^−28\s%$/u);
    expect(text).not.toMatch(/\p{L}/u);
  });
});

describe('кнопки наступления на карточке армии (04/T16)', () => {
  it('нарисованная линия — активна «Начать»; идёт — активна «Стоп»; без линии — кнопок нет', () => {
    expect(offensiveButtons(null)).toBeNull();
    expect(offensiveButtons({ active: false })).toEqual({ start: true, stop: false });
    expect(offensiveButtons({ active: true })).toEqual({ start: false, stop: true });
  });
});
