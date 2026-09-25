import { describe, expect, it } from 'vitest';

import { intDiv } from '../../src/math/int.ts';
import { neediestArmy } from '../../src/state/armies.ts';
import {
  armyOrder,
  assignFront,
  assignUnits,
  at,
  city,
  clearPlan,
  createArmy,
  move,
  own,
  scenario,
  setDefenseLine,
  type At,
} from '../scenario/dsl.ts';

// Граница вертикальная: столбец 2 (A) граничит со столбцом 3 (B) — фронт из 5 гексов.
const BORDER = `
  a  a  a  b  b
  a  a  a  b  b
  A1 a  a  b  B1
  a  a  a  b  b
  a  a  a  b  b
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  f: own('A', 'forest'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const W = 5;
const hexOf = (w: At): number => w.col + w.row * W;
const col = (hex: number): number => hex % W;
const row = (hex: number): number => intDiv(hex, W);

type S = ReturnType<typeof scenario>;

/** Создаёт армию игрока A из отрядов и возвращает её id. */
function armyOf(s: S, units: readonly number[]): number {
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(units, army));
  s.runTicks(1);
  return army;
}

const infantry = (s: S, n: number, where: At = at(0, 2)): number[] =>
  Array.from({ length: n }, () => s.unit('A', 'infantry', 100, where));

const hexesOf = (s: S, ids: readonly number[]): number[] =>
  ids.map((id) => s.unitById(id)?.hex ?? -1).sort((x, y) => x - y);

describe('линия фронта (CR-002)', () => {
  it('армия на всю границу: отряды расходятся по разным гексам фронта', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 5);
    const army = armyOf(s, ids);
    s.cmd('A', assignFront(army, 'B', null));
    s.runSeconds(25);
    expect(hexesOf(s, ids)).toEqual([0, 1, 2, 3, 4].map((r) => hexOf(at(2, r))));
  });

  it('отрядов меньше гексов, угрозы нет — встают равномерно вдоль линии', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 2);
    s.cmd('A', assignFront(armyOf(s, ids), 'B', null));
    s.runSeconds(25);
    expect(hexesOf(s, ids)).toEqual([hexOf(at(2, 1)), hexOf(at(2, 3))]);
  });

  it('угроза стягивает отряд к гексу рядом с врагом', () => {
    const s = scenario(BORDER, { legend });
    s.unit('B', 'infantry', 500, at(3, 4));
    const ids = infantry(s, 1);
    s.cmd('A', assignFront(armyOf(s, ids), 'B', null));
    s.runSeconds(25);
    // (3,4) граничит с (2,3) и (2,4).
    expect([hexOf(at(2, 3)), hexOf(at(2, 4))]).toContain(s.unitById(ids[0] ?? -1)?.hex);
  });

  it('бронетехника предпочитает равнину', () => {
    const s = scenario(
      `
      a  a  f  b  b
      a  a  a  b  b
      A1 a  f  b  B1
      a  a  f  b  b
      a  a  f  b  b
    `,
      { legend },
    );
    const armor = s.unit('A', 'armor', 100, at(0, 2));
    const inf = s.unit('A', 'infantry', 100, at(0, 2));
    s.cmd('A', assignFront(armyOf(s, [inf, armor]), 'B', null));
    s.runSeconds(25);
    // Два отряда на 5 гексах — места в строках 1 и 3; равнина — только строка 1.
    expect(s.unitById(armor)?.hex).toBe(hexOf(at(2, 1)));
    expect(s.unitById(inf)?.hex).toBe(hexOf(at(2, 3)));
  });

  it('артиллерия — на гекс позади линии, не на линии и не у врага', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 2);
    const art = s.unit('A', 'artillery', 100, at(0, 2));
    s.cmd('A', assignFront(armyOf(s, [...ids, art]), 'B', null));
    s.runSeconds(25);
    expect(col(s.unitById(art)?.hex ?? -1)).toBe(1);
  });

  it('участок: армия держит только часть фронта между двумя гексами', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 3);
    s.cmd('A', assignFront(armyOf(s, ids), 'B', [at(2, 0), at(2, 2)]));
    s.runSeconds(25);
    expect(hexesOf(s, ids)).toEqual([0, 1, 2].map((r) => hexOf(at(2, r))));
  });

  it('две армии на одном фронте делят его на смежные участки по солдатам', () => {
    const s = scenario(BORDER, { legend });
    const big = infantry(s, 3);
    const small = infantry(s, 2, at(0, 3));
    const x = armyOf(s, big);
    const y = armyOf(s, small);
    s.cmd('A', assignFront(x, 'B', null));
    s.cmd('A', assignFront(y, 'B', null));
    s.runSeconds(30);
    const rowsX = hexesOf(s, big).map(row);
    const rowsY = hexesOf(s, small).map(row);
    expect(rowsX).toEqual([0, 1, 2]);
    expect(rowsY).toEqual([3, 4]);
  });

  it('ручной приказ снимает отряд с места; выполнив его, отряд возвращается на фронт', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 1);
    s.cmd('A', assignFront(armyOf(s, ids), 'B', null));
    s.runSeconds(20);
    const onFront = s.unitById(ids[0] ?? -1)?.hex;
    expect(col(onFront ?? -1)).toBe(2);
    s.cmd('A', move(ids, at(0, 0)));
    // Приказ выполняется до конца: распределитель не перехватывает отряд по дороге.
    let arrived = false;
    for (let t = 0; t < 150 && !arrived; t += 1) {
      s.runTicks(1);
      arrived = s.unitById(ids[0] ?? -1)?.hex === hexOf(at(0, 0));
    }
    expect(arrived).toBe(true);
    s.runSeconds(20);
    expect(col(s.unitById(ids[0] ?? -1)?.hex ?? -1)).toBe(2);
  });

  it('малый прирост угрозы (< 15 %) не переставляет отряды', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 2);
    s.cmd('A', assignFront(armyOf(s, ids), 'B', null));
    s.runSeconds(25);
    const before = hexesOf(s, ids);
    s.unit('B', 'infantry', 10, at(3, 0));
    s.runSeconds(10);
    expect(hexesOf(s, ids)).toEqual(before);
  });

  it('«Держать» армии снимает план', () => {
    const s = scenario(BORDER, { legend });
    const army = armyOf(s, infantry(s, 1));
    s.cmd('A', assignFront(army, 'B', null));
    s.runTicks(1);
    expect(s.state.plans).toHaveLength(1);
    s.cmd('A', armyOrder(army, 'hold'));
    s.runTicks(1);
    expect(s.state.plans).toHaveLength(0);
  });

  it('clearPlan снимает план, отряды остаются на местах', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 1);
    const army = armyOf(s, ids);
    s.cmd('A', assignFront(army, 'B', null));
    s.runSeconds(20);
    const hex = s.unitById(ids[0] ?? -1)?.hex;
    s.cmd('A', clearPlan(army));
    s.runSeconds(10);
    expect(s.state.plans).toHaveLength(0);
    expect(s.unitById(ids[0] ?? -1)?.hex).toBe(hex);
  });
});

describe('линия обороны (CR-002)', () => {
  it('линия внутри страны: отряды встают на её гексы и не атакуют', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 5, at(0, 0));
    s.cmd('A', setDefenseLine(armyOf(s, ids), [at(1, 0), at(1, 4)]));
    s.runSeconds(25);
    expect(hexesOf(s, ids).map(col)).toEqual([1, 1, 1, 1, 1]);
    expect(s.state.units.every((u) => u.order !== 'attack')).toBe(true);
  });

  it('потерянный гекс линии пропускается', () => {
    const s = scenario(BORDER, { legend });
    const ids = infantry(s, 2, at(0, 0));
    s.cmd('A', setDefenseLine(armyOf(s, ids), [at(1, 0), at(1, 4)]));
    s.runTicks(1);
    s.setOwner(at(1, 1), 'B');
    s.runSeconds(25);
    expect(hexesOf(s, ids)).not.toContain(hexOf(at(1, 1)));
    expect(hexesOf(s, ids).map(col)).toEqual([1, 1]);
  });
});

describe('команды планов: отказы', () => {
  it('фронт против себя — notEnemy; линия через чужой гекс — notOwnHex; нет пути — noPath', () => {
    const s = scenario(
      `
      a  ~  a  b
      A1 ~  a  B1
    `,
      { legend },
    );
    const army = armyOf(s, infantry(s, 1, at(0, 0)));
    s.cmd('A', assignFront(army, 'A', null));
    s.cmd('A', setDefenseLine(army, [at(0, 0), at(3, 0)]));
    s.cmd('A', setDefenseLine(army, [at(0, 0), at(2, 0)]));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notEnemy', 'notOwnHex', 'noPath']);
  });
});

describe('автопополнение по фронту', () => {
  it('нуждаемость — меньше солдат на гекс линии; армии без плана — последними', () => {
    const s = scenario(BORDER, { legend });
    const onFront = armyOf(s, infantry(s, 3));
    const idle = armyOf(s, [s.unit('A', 'infantry', 50, at(0, 0))]);
    s.cmd('A', assignFront(onFront, 'B', null));
    s.runTicks(1);
    // 300 солдат на 5 гексов фронта — нуждается больше армии без плана с 50 солдатами.
    expect(neediestArmy(s.state, 0)).toBe(onFront);
    expect(idle).toBeGreaterThan(onFront);
  });
});
