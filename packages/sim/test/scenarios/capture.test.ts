import { describe, expect, it } from 'vitest';

import { at, city, move, own, scenario, setOrder, type At } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
  N2: city(null, 2),
};

function hexOf(s: ReturnType<typeof scenario>, w: At): number {
  return w.col + w.row * s.state.map.width;
}

describe('захват пустых гексов', () => {
  const MAP = `
    ~  ~  ~  ~  ~  ~
    A1 a  .  .  b  B1
    ~  ~  ~  ~  ~  ~
  `;

  it('армия занимает нейтральный гекс по завершении перехода, население не теряется', () => {
    const s = scenario(MAP, { legend });
    s.setPop(at(2, 1), 20);
    const id = s.army('A', 'infantry', 1, at(1, 1));
    s.cmd('A', move([id], at(2, 1)));
    s.runTicks(19);
    expect(s.owner(at(2, 1))).toBeNull();
    s.runTicks(1);
    expect(s.owner(at(2, 1))).toBe('A');
    expect(s.pop(at(2, 1))).toBeGreaterThanOrEqual(20_000);
  });

  it('пустой вражеский гекс захватывается, население −20 %', () => {
    const s = scenario(MAP, { legend });
    s.state.hexes.pop.fill(0);
    s.setPop(at(4, 1), 50);
    const id = s.army('A', 'armor', 100, at(3, 1));
    s.cmd('A', move([id], at(4, 1)));
    s.runSeconds(3);
    expect(s.owner(at(4, 1))).toBe('A');
    // До захвата гекс рос у столицы B 1,5 чел./с ≈ 1,2 с: (50 + 1,8) × 0,8 ≈ 41,4.
    expect(s.pop(at(4, 1))).toBeGreaterThanOrEqual(40_000);
    expect(s.pop(at(4, 1))).toBeLessThan(42_000);
  });

  it('промежуточные гексы пути тоже захватываются', () => {
    const s = scenario(MAP, { legend });
    const id = s.army('A', 'infantry', 100, at(1, 1));
    s.cmd('A', move([id], at(3, 1)));
    s.runSeconds(5);
    expect(s.owner(at(2, 1))).toBe('A');
    expect(s.owner(at(3, 1))).toBe('A');
  });

  it('артиллерия не захватывает: на чужой гекс её не пускает путь', () => {
    const s = scenario(MAP, { legend });
    const id = s.army('A', 'artillery', 100, at(1, 1));
    s.cmd('A', move([id], at(2, 1)));
    s.runSeconds(3);
    expect(s.owner(at(2, 1))).toBeNull();
    expect(s.rejections()).toEqual(['noPath']);
  });
});

describe('приказ expand', () => {
  it('армия занимает ближайшие нейтральные гексы у границы, пока они есть, затем idle', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~
      A1 a  .  .  ~
      ~  ~  ~  ~  ~
    `,
      { legend },
    );
    const id = s.army('A', 'infantry', 100, at(1, 1));
    s.cmd('A', setOrder([id], 'expand'));
    s.runSeconds(3);
    expect(s.owner(at(2, 1))).toBe('A');
    expect(s.owner(at(3, 1))).toBeNull();
    s.runSeconds(3);
    expect(s.owner(at(3, 1))).toBe('A');
    s.runTicks(1);
    expect(s.armyById(id)?.order).toBe('idle');
  });

  it('две армии на экспансии не идут в один гекс', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~
      .  a  A1 a  .
      ~  ~  ~  ~  ~
    `,
      { legend },
    );
    const x = s.army('A', 'infantry', 100, at(2, 1));
    const y = s.army('A', 'infantry', 100, at(2, 1));
    s.cmd('A', setOrder([x, y], 'expand'));
    s.runTicks(1);
    const targets = [x, y].map((id) => s.armyById(id)?.path.at(-1));
    expect(new Set(targets).size).toBe(2);
    s.runSeconds(10);
    expect(s.owner(at(0, 1))).toBe('A');
    expect(s.owner(at(4, 1))).toBe('A');
  });

  it('не идёт на вражеские гексы и в города с гарнизоном', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~
      N2 a  A1 b  B1
      ~  ~  ~  ~  ~
    `,
      { legend },
    );
    const id = s.army('A', 'infantry', 100, at(2, 1));
    s.cmd('A', setOrder([id], 'expand'));
    s.runSeconds(5);
    expect(s.owner(at(3, 1))).toBe('B');
    expect(s.owner(at(0, 1))).toBeNull();
    expect(s.armyById(id)?.order).toBe('idle');
    expect(s.armyById(id)?.hex).toBe(hexOf(s, at(2, 1)));
  });

  it('артиллерии приказ expand недоступен — отказ badOrder', () => {
    const s = scenario(
      `
      A1 a  .
    `,
      { legend },
    );
    const id = s.army('A', 'artillery', 100, at(1, 0));
    s.cmd('A', setOrder([id], 'expand'));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['badOrder']);
  });
});
