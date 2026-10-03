import { describe, expect, it } from 'vitest';

import { at, city, move, own, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
  N2: city(null, 2),
};

describe('захват пустых гексов', () => {
  const MAP = `
    ~  ~  ~  ~  ~  ~
    A1 a  .  .  b  B1
    ~  ~  ~  ~  ~  ~
  `;

  it('отряд занимает нейтральный гекс по завершении перехода, население не теряется', () => {
    const s = scenario(MAP, { legend });
    s.setPop(at(2, 1), 20);
    const id = s.unit('A', 'infantry', 1, at(1, 1));
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
    const id = s.unit('A', 'armor', 100, at(3, 1));
    s.cmd('A', move([id], at(4, 1)));
    s.runSeconds(3);
    expect(s.owner(at(4, 1))).toBe('A');
    // До захвата гекс рос у столицы B 1,5 чел./с ≈ 1,2 с: (50 + 1,8) × 0,8 ≈ 41,4.
    expect(s.pop(at(4, 1))).toBeGreaterThanOrEqual(40_000);
    expect(s.pop(at(4, 1))).toBeLessThan(42_000);
  });

  it('промежуточные гексы пути тоже захватываются', () => {
    const s = scenario(MAP, { legend });
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', move([id], at(3, 1)));
    s.runSeconds(5);
    expect(s.owner(at(2, 1))).toBe('A');
    expect(s.owner(at(3, 1))).toBe('A');
  });

  it('артиллерия не захватывает: на чужой гекс её не пускает путь', () => {
    const s = scenario(MAP, { legend });
    const id = s.unit('A', 'artillery', 100, at(1, 1));
    s.cmd('A', move([id], at(2, 1)));
    s.runSeconds(3);
    expect(s.owner(at(2, 1))).toBeNull();
    expect(s.rejections()).toEqual(['noPath']);
  });
});
