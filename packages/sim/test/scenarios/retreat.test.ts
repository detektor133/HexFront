import { describe, expect, it } from 'vitest';

import { FP } from '../../src/math/int.ts';
import { at, attack, city, move, own, scenario, type At } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const hexOf = (s: ReturnType<typeof scenario>, w: At): number => w.col + w.row * s.state.map.width;

/** Прогон, пока отряд не начнёт отступать или не исчезнет; возвращает число тиков. */
function untilBroken(s: ReturnType<typeof scenario>, unitId: number, limit = 400): number {
  for (let t = 1; t <= limit; t += 1) {
    s.runTicks(1);
    const u = s.unitById(unitId);
    if (!u || u.order === 'retreat') return t;
  }
  return -1;
}

describe('отступление', () => {
  const FIELD = `
    ~  ~  ~  ~  ~  ~
    A1 a  a  b  b  B1
    ~  ~  ~  ~  ~  ~
  `;

  it('есть куда отступить: отряд жив, в соседнем своём гексе, −5 % солдат', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 600, at(2, 1));
    const def = s.unit('B', 'infantry', 200, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    expect(untilBroken(s, def)).toBeGreaterThan(0);
    const u = s.unitById(def);
    expect(u?.hex).toBe(hexOf(s, at(4, 1)));
    expect(u?.org).toBe(0);
    expect(s.unitsOf('B')).toHaveLength(1);
    // Потери боя плюс 5 % при отступлении.
    expect(u?.soldiers).toBeLessThan(190 * FP);
  });

  it('во время отступления приказы отклоняются; по окончании org = 20', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 600, at(2, 1));
    const def = s.unit('B', 'infantry', 200, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    untilBroken(s, def);
    s.cmd('B', move([def], at(5, 1)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['retreating']);
    // Переход на равнину 2 с × 0,7 × ЗК 2 (рядом атакующий) ≈ 2,8 с.
    s.runSeconds(4);
    expect(s.unitById(def)?.order).toBe('idle');
    expect(s.unitById(def)?.org).toBeGreaterThanOrEqual(20 * FP);
  });

  it('все соседи чужие — капитуляция', () => {
    const s = scenario(
      `
      a  a  a
      a  b  a
      a  a  A1
    `,
      { legend },
    );
    s.unit('A', 'infantry', 900, at(0, 1));
    const def = s.unit('B', 'infantry', 100, at(1, 1));
    s.cmd('A', attack([s.unitsOf('A')[0]?.id ?? -1], at(1, 1)));
    untilBroken(s, def);
    expect(s.unitById(def)).toBeUndefined();
    expect(s.lastEvent('unitCapitulated')).toBeDefined();
  });

  it('соседи переполнены (3 отряда) — капитуляция', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~
      A1 a  b  b  ~
      ~  ~  ~  ~  ~
    `,
      { legend },
    );
    const att = s.unit('A', 'infantry', 900, at(1, 1));
    const def = s.unit('B', 'infantry', 100, at(2, 1));
    for (let i = 0; i < 3; i += 1) s.unit('B', 'infantry', 10, at(3, 1));
    s.cmd('A', attack([att], at(2, 1)));
    untilBroken(s, def);
    expect(s.unitById(def)).toBeUndefined();
  });

  it('приоритет: гекс не рядом с атакующими, затем меньший HexId', () => {
    const s = scenario(
      `
      b  b  b  ~
      A1 a  b  b
      b  b  b  ~
    `,
      { legend },
    );
    const att = s.unit('A', 'infantry', 900, at(1, 1));
    const def = s.unit('B', 'infantry', 100, at(2, 1));
    s.cmd('A', attack([att], at(2, 1)));
    untilBroken(s, def);
    // (1,0) и (1,2) соседствуют с атакующим (1,1); свободны от него (2,0), (2,2), (3,1).
    const hex = s.unitById(def)?.hex ?? -1;
    expect([hexOf(s, at(2, 0)), hexOf(s, at(2, 2)), hexOf(s, at(3, 1))]).toContain(hex);
  });

  it('цепочка отступлений: отступивший и снова атакованный отряд отходит дальше', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~  ~  ~
      A1 a  a  b  b  b  B1
      ~  ~  ~  ~  ~  ~  ~
    `,
      { legend },
    );
    const att = s.unit('A', 'infantry', 900, at(2, 1));
    const def = s.unit('B', 'infantry', 200, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    untilBroken(s, def);
    s.runTicks(1);
    s.cmd('A', attack([att], at(4, 1)));
    s.runSeconds(3);
    expect(s.unitById(def)?.hex).toBe(hexOf(s, at(5, 1)));
  });

  it('отступающий отряд под атакой теряет солдат вдвое быстрее', () => {
    const run = (retreating: boolean): number => {
      const s = scenario(
        `
        ~  ~  ~  ~  ~  ~  ~
        A1 a  a  b  b  b  B1
        ~  ~  ~  ~  ~  ~  ~
      `,
        { legend },
      );
      const first = s.unit('A', 'infantry', 900, at(2, 1));
      const def = s.unit('B', 'infantry', 400, at(3, 1));
      const second = s.unit('A', 'infantry', 300, at(5, 0 + 1));
      if (retreating) {
        s.cmd('A', attack([first], at(3, 1)));
        untilBroken(s, def);
      } else {
        s.cmd('B', move([def], at(4, 1)));
        s.runSeconds(3);
      }
      const before = s.unitById(def)?.soldiers ?? 0;
      s.cmd('A', attack([second], at(4, 1)));
      s.runTicks(5);
      return before - (s.unitById(def)?.soldiers ?? 0);
    };
    expect(run(true)).toBeGreaterThan(run(false) * 1.8);
  });
});
