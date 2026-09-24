import { describe, expect, it } from 'vitest';

import small from '../../../mapgen/maps/small.json' with { type: 'json' };
import { TICKS_PER_S } from '../../src/balance.ts';
import { loadMap } from '../../src/map/load.ts';
import { FEATURE } from '../../src/map/types.ts';
import { createMatch } from '../../src/state/create-match.ts';
import { step } from '../../src/step.ts';
import { at, city, own, scenario, setTax } from '../scenario/dsl.ts';

const goldPerSecond = (before: number, after: number, seconds: number): number =>
  (after - before) / 1000 / seconds;

describe('доход', () => {
  it('стартовый доход на small ≈ +1,06 золота/с (±5 %)', () => {
    const result = loadMap(small);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const s = createMatch(result.map, [{ name: 'A' }, { name: 'B' }], 42);
    const before = s.players.map((p) => p.gold);
    for (let i = 0; i < TICKS_PER_S; i += 1) step(s, []);
    s.players.forEach((p, i) => {
      const income = goldPerSecond(before[i] ?? 0, p.gold, 1);
      expect(income).toBeGreaterThan(1.06 * 0.95);
      expect(income).toBeLessThan(1.06 * 1.05);
    });
  });

  const MAP = `
    .  .  .  .  .  .
    .  A1 a  .  B1 b
    .  .  .  .  .  .
  `;
  const legend = {
    A1: city('A', 2, { capital: true }),
    a: own('A'),
    B1: city('B', 1, { capital: true }),
    b: own('B'),
  };

  function incomeOf(setup: (s: ReturnType<typeof scenario>) => void): number {
    const s = scenario(MAP, { legend });
    s.state.hexes.pop.fill(0);
    setup(s);
    const before = s.player('A').gold;
    // Налог выставлен заранее, чтобы не ждать инерции; рост на доход за 1 с не влияет.
    s.runSeconds(1);
    return goldPerSecond(before, s.player('A').gold, 1);
  }

  it('город даёт 0,5 золота/с за уровень', () => {
    expect(incomeOf(() => {})).toBeCloseTo(1.0, 2);
  });

  it('население платит pop × налог × 0,01', () => {
    const income = incomeOf((s) => {
      s.setPop(at(2, 1), 100);
      s.player('A').taxEffective = s.player('A').taxTarget;
    });
    // 100 чел. × 20 % × 0,01 = 0,2 + город 1,0; рост за секунду добавляет доли процента.
    expect(income).toBeCloseTo(1.2, 1);
  });

  it('налог 0 % — доход только от городов и шахт', () => {
    const s = scenario(MAP, { legend });
    s.cmd('A', setTax(0));
    s.runSeconds(20);
    const before = s.player('A').gold;
    s.runSeconds(1);
    expect(goldPerSecond(before, s.player('A').gold, 1)).toBeCloseTo(1.0, 2);
  });

  it('своя шахта даёт +1 золото/с, шахта на нейтральном гексе — ничего', () => {
    const own = incomeOf((s) => (s.state.map.features[2 + 1 * s.state.map.width] = FEATURE.mine));
    const neutral = incomeOf(
      (s) => (s.state.map.features[3 + 1 * s.state.map.width] = FEATURE.mine),
    );
    expect(own).toBeCloseTo(2.0, 2);
    expect(neutral).toBeCloseTo(1.0, 2);
  });

  it('чужие и нейтральные гексы в доход игрока не идут', () => {
    const income = incomeOf((s) => {
      s.setPop(at(5, 1), 100);
      s.setPop(at(0, 0), 100);
    });
    expect(income).toBeCloseTo(1.0, 2);
  });

  it('золото не уходит в минус и остаётся целым', () => {
    const s = scenario(MAP, { legend });
    s.runSeconds(30);
    for (const p of s.state.players) {
      expect(Number.isSafeInteger(p.gold)).toBe(true);
      expect(p.gold).toBeGreaterThanOrEqual(0);
    }
  });
});
