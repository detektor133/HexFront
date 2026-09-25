import { describe, expect, it } from 'vitest';

import { intDiv } from '../../src/math/int.ts';
import { findPath } from '../../src/queries/unit-path.ts';
import {
  at,
  city,
  merge,
  move,
  own,
  road,
  scenario,
  setOrder,
  split,
  type At,
} from '../scenario/dsl.ts';

// Полоса своих равнин A; B — соперник справа. Соседние клетки одной строки — всегда соседи гекса.
const LINE = `
  a  a  a  a  a  a  .  .
  A1 a  a  a  a  a  .  B1
  a  a  a  a  a  a  .  .
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  f: own('A', 'forest'),
  r: road('A'),
  m: own('A', 'mountains'),
};

const idOf = (s: ReturnType<typeof scenario>, w: At): number => w.col + w.row * s.state.map.width;

/** Сколько тиков отряд идёт до гекса-цели (или -1, если не дошёл за limit тиков). */
function ticksToArrive(
  s: ReturnType<typeof scenario>,
  unitId: number,
  to: At,
  limit = 600,
): number {
  const target = idOf(s, to);
  for (let t = 1; t <= limit; t += 1) {
    s.runTicks(1);
    if (s.unitById(unitId)?.hex === target) return t;
  }
  return -1;
}

describe('движение: время перехода', () => {
  it('пехота по равнине — 2 с на гекс', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', move([id], at(2, 1)));
    expect(ticksToArrive(s, id, at(2, 1))).toBe(20);
  });

  it('бронетехника по равнине — 2 / 1,6 = 1,25 с (12 тиков)', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'armor', 100, at(1, 1));
    s.cmd('A', move([id], at(2, 1)));
    expect(ticksToArrive(s, id, at(2, 1))).toBe(12);
  });

  it('пехота в лес — 3 / 0,7 ≈ 4,28 с (42 тика), в горы — 5 / 0,5 = 10 с', () => {
    const s = scenario(
      `
      A1 a  f  m
    `,
      { legend },
    );
    // Столица рядом — снабжение выше 50 %, скорость без штрафа.
    const id = s.unit('A', 'infantry', 100, at(1, 0));
    s.cmd('A', move([id], at(2, 0)));
    expect(ticksToArrive(s, id, at(2, 0))).toBe(42);
    s.cmd('A', move([id], at(3, 0)));
    expect(ticksToArrive(s, id, at(3, 0))).toBe(100);
  });

  it('дорога ×0,5, если оба гекса дорожные — по любым дорогам, и по чужим', () => {
    const s = scenario(
      `
      A1 r  r  b  b
    `,
      { legend: { ...legend, b: { kind: 'own', player: 'B', terrain: 'plains', road: true } } },
    );
    const id = s.unit('A', 'infantry', 100, at(1, 0));
    s.cmd('A', move([id], at(2, 0)));
    expect(ticksToArrive(s, id, at(2, 0))).toBe(10);
    s.cmd('A', move([id], at(3, 0)));
    expect(ticksToArrive(s, id, at(3, 0))).toBe(10);
  });

  it('переход через реку +1 с', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    // Направление 0 (SE) из (1,1) нечётного столбца ведёт в (2,1).
    s.river(at(1, 1), 0);
    s.cmd('A', move([id], at(2, 1)));
    expect(ticksToArrive(s, id, at(2, 1))).toBe(30);
  });

  it('зона контроля: гекс-назначение рядом с вражеским отрядом — время ×2', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'infantry', 100, at(4, 1));
    s.unit('B', 'infantry', 100, at(6, 1));
    s.cmd('A', move([id], at(5, 1)));
    expect(ticksToArrive(s, id, at(5, 1))).toBe(40);
  });

  it('снабжение ниже 50 % — скорость ×0,75 (2 / 0,75 ≈ 2,67 с)', () => {
    const s = scenario(LINE, { legend });
    // Столица даёт 500 на 2000 пехоты: R = 25 %, × 0,88 за гекс от города ≈ 22 %.
    const id = s.unit('A', 'infantry', 2000, at(1, 1));
    s.cmd('A', move([id], at(2, 1)));
    expect(ticksToArrive(s, id, at(2, 1))).toBe(26);
  });

  it('несколько гексов подряд: путь идёт гекс за гексом, в конце приказ idle', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', move([id], at(5, 1)));
    s.runTicks(1);
    expect(s.unitById(id)?.order).toBe('move');
    // В пути отряд числится в старом гексе, пока переход не завершён.
    s.runTicks(18);
    expect(s.unitById(id)?.hex).toBe(idOf(s, at(1, 1)));
    expect(ticksToArrive(s, id, at(5, 1))).toBe(80 - 19);
    expect(s.unitById(id)?.order).toBe('idle');
    expect(s.unitById(id)?.path).toEqual([]);
  });
});

describe('движение: путь', () => {
  it('A* предпочитает дорогу в обход, если так быстрее', () => {
    const s = scenario(
      `
      r  r  r  r  r
      a  f  f  f  a
    `,
      { legend },
    );
    const path = findPath(s.state, idOf(s, at(0, 1)), idOf(s, at(4, 1)), 'infantry', 0);
    expect(path).not.toBeNull();
    // Через лес — 4 × 4,28 с; по дороге сверху — заметно быстрее.
    expect(path?.some((h) => s.state.map.terrain[h] === 2)).toBe(false);
  });

  it('путь детерминирован: повторный вызов даёт тот же результат', () => {
    const s = scenario(LINE, { legend });
    const a = findPath(s.state, idOf(s, at(0, 0)), idOf(s, at(5, 2)), 'infantry', 0);
    const b = findPath(s.state, idOf(s, at(0, 0)), idOf(s, at(5, 2)), 'infantry', 0);
    expect(a).toEqual(b);
    expect(a?.at(-1)).toBe(idOf(s, at(5, 2)));
  });

  it('вода непроходима: пути нет — отказ noPath', () => {
    const s = scenario(
      `
      a  ~  a
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 100, at(0, 0));
    s.cmd('A', move([id], at(2, 0)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['noPath']);
  });

  it('артиллерия ходит только по своим гексам', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'artillery', 100, at(5, 1));
    s.cmd('A', move([id], at(6, 1)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['noPath']);
  });

  it('пехота может идти на нейтральный гекс', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'infantry', 100, at(5, 1));
    s.cmd('A', move([id], at(6, 1)));
    expect(ticksToArrive(s, id, at(6, 1))).toBeGreaterThan(0);
  });

  it('цель — полный гекс (3 своих отряда) — отказ hexFull', () => {
    const s = scenario(LINE, { legend });
    for (let i = 0; i < 3; i += 1) s.unit('A', 'infantry', 50, at(3, 1));
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', move([id], at(3, 1)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['hexFull']);
  });

  it('путь обходит полные гексы', () => {
    const s = scenario(
      `
      a  a  a
      a  a  a
      a  a  a
    `,
      { legend },
    );
    for (let i = 0; i < 3; i += 1) s.unit('A', 'infantry', 50, at(1, 1));
    const path = findPath(s.state, idOf(s, at(0, 1)), idOf(s, at(2, 1)), 'infantry', 0);
    expect(path).not.toBeNull();
    expect(path).not.toContain(idOf(s, at(1, 1)));
  });

  it('гекс на пути заполнился — отряд ждёт перед ним, потом идёт дальше', () => {
    const s = scenario(
      `
      ~  ~  ~  ~
      a  a  a  a
      ~  ~  ~  ~
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 100, at(0, 1));
    s.cmd('A', move([id], at(3, 1)));
    s.runTicks(1);
    const blockers = [0, 1, 2].map(() => s.unit('A', 'infantry', 50, at(1, 1)));
    s.runSeconds(10);
    expect(s.unitById(id)?.hex).toBe(idOf(s, at(0, 1)));
    s.cmd('A', move([blockers[0] ?? -1], at(2, 1)));
    expect(ticksToArrive(s, id, at(3, 1))).toBeGreaterThan(0);
  });

  it('следующий гекс занят врагом — отряд останавливается перед ним (атака — 03/T5)', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~  ~
      a  a  a  a  a  B1
      ~  ~  ~  ~  ~  ~
    `,
      { legend },
    );
    const id = s.unit('A', 'infantry', 100, at(0, 1));
    s.cmd('A', move([id], at(4, 1)));
    s.runTicks(1);
    s.unit('B', 'infantry', 100, at(2, 1));
    s.runSeconds(20);
    expect(s.unitById(id)?.hex).toBe(idOf(s, at(1, 1)));
    expect(s.unitById(id)?.order).toBe('idle');
  });
});

describe('приказы, разделение, слияние', () => {
  it('hold останавливает движение', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', move([id], at(5, 1)));
    s.runTicks(5);
    s.cmd('A', setOrder([id], 'hold'));
    s.runSeconds(10);
    expect(s.unitById(id)?.hex).toBe(idOf(s, at(1, 1)));
    expect(s.unitById(id)?.order).toBe('hold');
  });

  it('чужой и несуществующий отряд — отказ', () => {
    const s = scenario(LINE, { legend });
    const b = s.unit('B', 'infantry', 100, at(7, 0));
    s.cmd('A', move([b], at(1, 0)));
    s.cmd('A', move([999], at(1, 0)));
    s.cmd('A', setOrder([b], 'hold'));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notOwnUnit', 'unknownUnit', 'notOwnUnit']);
  });

  it('разделение: новый отряд в том же гексе, org копируется', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'infantry', 300, at(1, 1));
    s.setOrg(id, 70);
    s.cmd('A', split(id, 120));
    s.runTicks(1);
    const mine = s.unitsOf('A');
    expect(mine).toHaveLength(2);
    expect(mine[0]?.soldiers).toBe(180_000);
    expect(mine[1]?.soldiers).toBe(120_000);
    expect(mine[1]?.hex).toBe(mine[0]?.hex);
    // Копия org; затем в том же тике оба восстановили по 0,4 (4/с вне боя).
    expect(mine[1]?.org).toBe(mine[0]?.org);
    expect(mine[1]?.org).toBe(70_400);
  });

  it('разделение: 0, всё войско, нет места в гексе — отказ', () => {
    const s = scenario(LINE, { legend });
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', split(id, 0));
    s.cmd('A', split(id, 100));
    s.runTicks(1);
    s.unit('A', 'infantry', 50, at(1, 1));
    s.unit('A', 'infantry', 50, at(1, 1));
    s.cmd('A', split(id, 50));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['invalidAmount', 'invalidAmount', 'hexFull']);
  });

  it('разделение упирается в лимит отрядов', () => {
    const s = scenario(LINE, { legend });
    // Лимит 4 + 2 × 1 город = 6.
    const ids = [0, 1, 2, 3, 4, 5].map((i) => s.unit('A', 'infantry', 100, at(i, 0)));
    s.cmd('A', split(ids[0] ?? -1, 50));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['unitLimit']);
  });

  it('слияние: солдаты суммируются, org — средневзвешенная', () => {
    const s = scenario(LINE, { legend });
    const a = s.unit('A', 'infantry', 300, at(1, 1));
    const b = s.unit('A', 'infantry', 100, at(1, 1));
    s.setOrg(a, 60);
    s.cmd('A', merge([a, b]));
    s.runTicks(1);
    const mine = s.unitsOf('A');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.id).toBe(a);
    expect(mine[0]?.soldiers).toBe(400_000);
    // (300 × 60 + 100 × 100) / 400 = 70, плюс 0,4 восстановления за тик.
    expect(mine[0]?.org).toBe(70_400);
  });

  it('слияние: разные гексы или типы — отказ', () => {
    const s = scenario(LINE, { legend });
    const a = s.unit('A', 'infantry', 100, at(1, 1));
    const b = s.unit('A', 'infantry', 100, at(2, 1));
    const c = s.unit('A', 'armor', 100, at(1, 1));
    s.cmd('A', merge([a, b]));
    s.cmd('A', merge([a, c]));
    s.cmd('A', merge([a]));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notSameHex', 'notSameType', 'invalidAmount']);
  });
});

describe('новый приказ посреди перехода', () => {
  const CROSS = `
    a  a  a  a
    A1 a  a  a
    a  a  a  a
  `;

  it('путь в тот же соседний гекс — прогресс перехода сохраняется', () => {
    const s = scenario(CROSS, { legend });
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', move([id], at(3, 1)));
    s.runTicks(10);
    const ticks = s.unitById(id)?.moveTicks ?? 0;
    expect(ticks).toBeGreaterThan(5);
    // Новая цель — тот самый гекс, куда отряд уже идёт: первый шаг пути совпадает.
    const next = s.unitById(id)?.path[0] ?? -1;
    s.cmd('A', move([id], at(next % 4, intDiv(next, 4))));
    s.runTicks(1);
    expect(s.unitById(id)?.moveTicks).toBe(ticks + 1);
  });

  it('путь в другую сторону — отряд остаётся в своём гексе, переход начинается заново', () => {
    const s = scenario(CROSS, { legend });
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', move([id], at(3, 1)));
    s.runTicks(10);
    s.cmd('A', move([id], at(0, 1)));
    s.runTicks(1);
    expect(s.unitById(id)?.hex).toBe(1 + 1 * 4);
    expect(s.unitById(id)?.moveTicks).toBe(1);
  });
});
