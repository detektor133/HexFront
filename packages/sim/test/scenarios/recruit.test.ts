import { describe, expect, it } from 'vitest';

import { recruitCapacity } from '../../src/commands/recruit.ts';
import { FP, type Fp } from '../../src/math/int.ts';
import {
  assignUnits,
  at,
  city,
  createArmy,
  own,
  recruit,
  scenario,
  setAutoReinforce,
} from '../scenario/dsl.ts';

// Столица A в (1,1), вокруг — свои равнины; B — сосед справа.
const MAP = `
  a  a  a  .  .  .
  a  A1 a  .  B1 b
  a  a  a  .  .  .
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

function setup() {
  const s = scenario(MAP, { legend });
  // Лимит равнины 100 → минимум 10; город ур. 1 — лимит 300 → минимум 30.
  s.setPop(at(1, 1), 230);
  for (const [c, r] of [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ] as const) {
    s.setPop(at(c, r), 60);
  }
  return s;
}

describe('набор отрядов', () => {
  it('пехота 100: золото сразу, отряд появляется через 9 с в городе с org 100', () => {
    const s = setup();
    const gold = s.player('A').gold;
    s.cmd('A', recruit(at(1, 1), 'infantry', 100));
    s.runTicks(1);
    expect(s.player('A').gold).toBeLessThanOrEqual(gold - 10 * FP + 2 * FP);
    expect(s.unitsOf('A')).toHaveLength(0);
    s.runTicks(89);
    expect(s.unitsOf('A')).toHaveLength(1);
    const unit = s.unitsOf('A')[0];
    expect(unit?.hex).toBe(1 + 1 * 6);
    expect(unit?.soldiers).toBe(100 * FP);
    expect(unit?.org).toBe(100 * FP);
    expect(unit?.order).toBe('idle');
    expect(s.lastEvent('unitRecruited')).toBeDefined();
  });

  it('время: бронетехника 200 — 15 + 2 × 2 = 19 с', () => {
    const s = setup();
    s.player('A').gold = (1000 * FP) as Fp;
    s.cmd('A', recruit(at(1, 1), 'armor', 200));
    s.runTicks(189);
    expect(s.unitsOf('A')).toHaveLength(0);
    s.runTicks(1);
    expect(s.unitsOf('A')).toHaveLength(1);
  });

  it('люди списываются пропорционально излишку, ни один гекс не ниже 10 % лимита', () => {
    const s = setup();
    // Излишек: город 230 − 30 = 200, восемь гексов по 60 − 10 = 50 → всего 600.
    expect(recruitCapacity(s.state, s.cityAt(at(1, 1))?.id ?? -1)).toBe(600 * FP);
    s.cmd('A', recruit(at(1, 1), 'infantry', 300));
    s.runTicks(1);
    // Половина излишка: город −100, каждый гекс −25 (плюс рост за тик).
    expect(s.pop(at(1, 1))).toBeGreaterThanOrEqual(130 * FP);
    expect(s.pop(at(1, 1))).toBeLessThan(131 * FP);
    expect(s.pop(at(0, 0))).toBeGreaterThanOrEqual(35 * FP);
    expect(s.pop(at(0, 0))).toBeLessThan(36 * FP);
  });

  it('весь излишек: гексы остаются ровно на 10 % лимита', () => {
    const s = setup();
    s.player('A').gold = (1000 * FP) as Fp;
    s.cmd('A', recruit(at(1, 1), 'infantry', 600));
    s.runTicks(1);
    expect(s.rejections()).toEqual([]);
    expect(s.pop(at(0, 0))).toBeGreaterThanOrEqual(10 * FP);
    expect(s.pop(at(0, 0))).toBeLessThan(11 * FP);
    expect(s.pop(at(1, 1))).toBeGreaterThanOrEqual(30 * FP);
  });

  it('больше излишка — отказ notEnoughPeople', () => {
    const s = setup();
    s.player('A').gold = (1000 * FP) as Fp;
    s.cmd('A', recruit(at(1, 1), 'infantry', 650));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notEnoughPeople']);
  });

  it('количество: меньше 50 или не кратно 50 — отказ invalidAmount', () => {
    const s = setup();
    s.cmd('A', recruit(at(1, 1), 'infantry', 0));
    s.cmd('A', recruit(at(1, 1), 'infantry', 75));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['invalidAmount', 'invalidAmount']);
  });

  it('чужой и несуществующий город — отказ', () => {
    const s = setup();
    s.cmd('A', recruit(at(4, 1), 'infantry', 50));
    s.cmd('A', recruit(at(3, 1), 'infantry', 50));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notOwnCity', 'unknownCity']);
  });

  it('одна единица набора на город: вторая — отказ queueBusy', () => {
    const s = setup();
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['queueBusy']);
  });

  it('лимит отрядов 4 + 2 × городов считает и очередь набора', () => {
    const s = setup();
    for (let i = 0; i < 5; i += 1) s.unit('A', 'infantry', 50, at(0, 0 + (i % 3)));
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.runTicks(1);
    expect(s.rejections()).toEqual([]);
    s.runTicks(100);
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['unitLimit']);
  });

  it('не хватает золота — отказ notEnoughGold', () => {
    const s = setup();
    s.player('A').gold = (9 * FP) as Fp;
    s.cmd('A', recruit(at(1, 1), 'infantry', 100));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notEnoughGold']);
  });

  it('в городе 3 отряда — новый появляется в ближайшем своём свободном гексе', () => {
    const s = setup();
    for (let i = 0; i < 3; i += 1) s.unit('A', 'infantry', 50, at(1, 1));
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.runSeconds(9);
    const fresh = s.unitsOf('A')[3];
    expect(fresh).toBeDefined();
    // Соседи города — кольцо 1; при равенстве дистанции — наименьший HexId. Столбец 1 нечётный
    // и сдвинут вверх (even-q), поэтому (0,0) — сосед (1,1), его HexId 0.
    expect(fresh?.hex).toBe(0);
  });

  it('потеря города отменяет набор без возврата золота', () => {
    const s = setup();
    s.cmd('A', recruit(at(1, 1), 'infantry', 100));
    s.runTicks(1);
    const gold = s.player('A').gold;
    // setOwner переносит и город: город всегда принадлежит владельцу своего гекса.
    s.setOwner(at(1, 1), 'B');
    s.runSeconds(10);
    expect(s.unitsOf('A')).toHaveLength(0);
    expect(s.lastEvent('recruitCancelled')).toBeDefined();
    expect(s.player('A').gold).toBeLessThan(gold + 20 * FP);
  });
});

describe('набор в резерв и «Автопополнение» (CR-001)', () => {
  function withTwoArmies() {
    const s = setup();
    s.player('A').gold = (1000 * FP) as Fp;
    s.cmd('A', createArmy('Первая'));
    s.cmd('A', createArmy('Вторая'));
    s.runTicks(1);
    return s;
  }

  it('без переключателя новый отряд попадает в резерв', () => {
    const s = withTwoArmies();
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.runSeconds(9);
    expect(s.unitsOf('A')[0]?.armyId).toBeNull();
  });

  it('с переключателем — в армию с наименьшим числом солдат', () => {
    const s = withTwoArmies();
    const [first, second] = s.armiesOf('A');
    const big = s.unit('A', 'infantry', 300, at(0, 0));
    const small = s.unit('A', 'infantry', 100, at(2, 2));
    s.cmd('A', assignUnits([big], first?.id ?? -1));
    s.cmd('A', assignUnits([small], second?.id ?? -1));
    s.cmd('A', setAutoReinforce(true));
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.runSeconds(9);
    expect(s.player('A').autoReinforce).toBe(true);
    expect(s.unitsOf('A').at(-1)?.armyId).toBe(second?.id);
  });

  it('при равенстве — армия с меньшим id; без армий — резерв', () => {
    const s = withTwoArmies();
    s.cmd('A', setAutoReinforce(true));
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.runSeconds(9);
    expect(s.unitsOf('A').at(-1)?.armyId).toBe(s.armiesOf('A')[0]?.id);

    const lone = setup();
    lone.cmd('A', setAutoReinforce(true));
    lone.cmd('A', recruit(at(1, 1), 'infantry', 50));
    lone.runSeconds(9);
    expect(lone.unitsOf('A')[0]?.armyId).toBeNull();
  });

  it('выключение переключателя возвращает набор в резерв', () => {
    const s = withTwoArmies();
    s.cmd('A', setAutoReinforce(true));
    s.runTicks(1);
    s.cmd('A', setAutoReinforce(false));
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.runSeconds(9);
    expect(s.player('A').autoReinforce).toBe(false);
    expect(s.unitsOf('A')[0]?.armyId).toBeNull();
  });
});
