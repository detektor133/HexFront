import { describe, expect, it } from 'vitest';

import { NETWORK_RECALC_TICKS, TICKS_PER_S } from '../../src/balance.ts';
import type { Fp } from '../../src/math/int.ts';
import { hashState } from '../../src/state/hash.ts';
import { isCityIsolated } from '../../src/state/network.ts';
import { at, city, own, road, scenario, type At } from '../scenario/dsl.ts';

// Столица A1 и город A2 соединены дорогой по строке 1.
const LINE = `
  a  a  a  a  a  a  a  a  a
  a  A1 r  r  r  r  A2 a  a
  a  a  a  a  a  a  a  a  a
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  a: own('A'),
  r: road('A'),
};
const A2 = at(6, 1);
const CUT = at(3, 1);

type S = ReturnType<typeof scenario>;
const isolated = (s: S, where: At): boolean => {
  const c = s.cityAt(where);
  if (!c) throw new Error('нет города');
  return isCityIsolated(s.state, c.id);
};

describe('сети снабжения', () => {
  it('город, связанный дорогой со столицей, — в основной сети', () => {
    const s = scenario(LINE, { legend });
    s.runTicks(1);
    expect(isolated(s, A2)).toBe(false);
  });

  it('разрез дороги изолирует город не позже чем через 10 тиков', () => {
    const s = scenario(LINE, { legend });
    s.runTicks(1);
    s.setOwner(CUT, null);
    s.runTicks(NETWORK_RECALC_TICKS);
    expect(isolated(s, A2)).toBe(true);
  });

  it('восстановление связи возвращает город в основную сеть', () => {
    const s = scenario(LINE, { legend });
    s.setOwner(CUT, null);
    s.runTicks(NETWORK_RECALC_TICKS);
    expect(isolated(s, A2)).toBe(true);
    s.setOwner(CUT, 'A');
    s.runTicks(NETWORK_RECALC_TICKS);
    expect(isolated(s, A2)).toBe(false);
  });

  it('пересчёт размазан: игрок i пересчитывается в тике tick % 10 == i % 10', () => {
    const TWO = `
      a  A1 r  A2 .  b  B1 q  B2
    `;
    const s = scenario(TWO, {
      legend: {
        ...legend,
        b: own('B'),
        B1: city('B', 1, { capital: true }),
        B2: city('B', 1),
        q: road('B'),
      },
    });
    const bRoad = at(7, 0);
    s.runTicks(NETWORK_RECALC_TICKS);
    expect(isolated(s, at(8, 0))).toBe(false);
    // Тик 10 — пересчёт игрока 0; игрок 1 (B) увидит разрез только в тике 11.
    s.setOwner(bRoad, null);
    s.runTicks(1);
    expect(isolated(s, at(8, 0))).toBe(false);
    s.runTicks(1);
    expect(isolated(s, at(8, 0))).toBe(true);
  });

  it('изолированный город растит население ×0,75', () => {
    const grow = (cut: boolean): number => {
      const s = scenario(LINE, { legend });
      if (cut) s.setOwner(CUT, null);
      s.runTicks(NETWORK_RECALC_TICKS);
      const hex = at(7, 1);
      s.setPop(hex, 0);
      s.runTicks(1);
      return (s.pop(hex) * TICKS_PER_S) / 1000;
    };
    expect(grow(false)).toBeCloseTo(1.5, 2);
    expect(grow(true)).toBeCloseTo(1.5 * 0.75, 2);
  });

  it('изолированный город и его гексы дают золото ×0,5', () => {
    const income = (cut: boolean): number => {
      const s = scenario(LINE, { legend });
      if (cut) s.setOwner(CUT, null);
      s.runTicks(NETWORK_RECALC_TICKS);
      // Население задаём после пересчёта сетей и меряем один тик, чтобы рост не добавлял налог.
      s.state.hexes.pop.fill(0);
      s.setPop(at(7, 1), 100);
      const before = s.player('A').gold;
      s.runTicks(1);
      return ((s.player('A').gold - before) * TICKS_PER_S) / 1000;
    };
    // Связано: 2 города × 0,5 + 100 чел. × 20 % × 0,01 = 1,2; изолировано: 0,5 + 0,25 + 0,1 = 0,85.
    expect(income(false)).toBeCloseTo(1.2, 1);
    expect(income(true)).toBeCloseTo(0.85, 1);
  });

  it('сети детерминированы: одинаковые прогоны дают одинаковый хэш', () => {
    const run = (): string => {
      const s = scenario(LINE, { legend });
      s.player('A').gold = (500 * 1000) as Fp;
      s.setOwner(CUT, null);
      s.runSeconds(3);
      s.setOwner(CUT, 'A');
      s.runSeconds(3);
      return hashState(s.state);
    };
    expect(run()).toBe(run());
  });
});
