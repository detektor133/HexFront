import { describe, expect, it } from 'vitest';

import { minCostAssignment } from '../../src/math/assign.ts';
import { allocate } from '../../src/state/allocate.ts';
import { assignFront, assignUnits, at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

describe('оптимальное назначение', () => {
  it('минимизирует сумму стоимостей, а не берёт жадно первую лучшую пару', () => {
    // Жадный перебор отдал бы строке 0 столбец 0 (1), строке 1 — столбец 1 (9): всего 10.
    // Оптимум: 0→1 (2) и 1→0 (2): всего 4.
    expect(
      minCostAssignment([
        [1, 2],
        [2, 9],
      ]),
    ).toEqual([1, 0]);
  });

  it('строк меньше столбцов: каждой строке свой столбец, лишние столбцы пустуют', () => {
    const pick = minCostAssignment([
      [5, 1, 9],
      [4, 8, 2],
    ]);
    expect(pick).toEqual([1, 2]);
  });
});

// Линия фронта вдоль границы A|B, три отряда A стоят на своих местах.
const MAP = `
  A1 a  a  b  B1
  a  a  a  b  b
  a  a  a  b  b
  a  a  a  b  b
  a  a  a  b  b
  a  a  a  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('распределение по фронту без перетасовки', () => {
  it('новый отряд получает место, а стоящие на линии не меняют своих', () => {
    const s = scenario(MAP, { legend });
    const ids = [0, 1, 2].map((row) => s.unit('A', 'infantry', 200, at(2, row)));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const armyId = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits(ids, armyId));
    s.cmd('A', assignFront(armyId, 'B', null));
    s.runSeconds(40);
    const plan = s.state.plans.find((p) => p.armyId === armyId);
    if (!plan) throw new Error('нет плана фронта');
    const mine = s.state.units.filter((u) => ids.includes(u.id));
    expect(mine.every((u) => u.slot >= 0)).toBe(true);
    const before = new Map(mine.map((u) => [u.id, u.slot]));
    // Четвёртый отряд пришёл из резерва без места.
    const extra = s.unit('A', 'infantry', 200, at(1, 5));
    const fresh = s.state.units.find((u) => u.id === extra);
    if (!fresh) throw new Error('нет отряда');
    fresh.armyId = armyId;
    fresh.slot = -1;
    const alloc = allocate(s.state, plan, 0);
    for (const [id, slot] of before) expect(alloc.kept.get(id)).toBe(slot);
    expect(alloc.kept.get(extra)).toBeGreaterThanOrEqual(0);
  });
});
