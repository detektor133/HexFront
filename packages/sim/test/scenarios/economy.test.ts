import { describe, expect, it } from 'vitest';

import small from '../../../mapgen/maps/small.json' with { type: 'json' };
import { TICKS_PER_S } from '../../src/balance.ts';
import { loadMap } from '../../src/map/load.ts';
import { FEATURE } from '../../src/map/types.ts';
import type { Fp } from '../../src/math/int.ts';
import { createMatch } from '../../src/state/create-match.ts';
import { step } from '../../src/step.ts';
import { playerIncomePerSecond, playerUpkeepPerSecond } from '../../src/systems/economy.ts';
import { at, build, city, own, recruit, scenario, setTax } from '../scenario/dsl.ts';

const goldPerSecond = (before: number, after: number, seconds: number): number =>
  (after - before) / 1000 / seconds;

describe('доход', () => {
  it('стартовый доход на small ≈ +1,06 золота/с (±5 %)', () => {
    const result = loadMap(small);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const s = createMatch(result.map, [{ name: 'A' }, { name: 'B' }], 42);
    const before = s.players.map((p) => p.gold);
    s.players.forEach((_, i) => {
      const income = playerIncomePerSecond(s, i) / 1000;
      expect(income).toBeGreaterThan(1.06 * 0.95);
      expect(income).toBeLessThan(1.06 * 1.05);
      expect(playerUpkeepPerSecond(s, i)).toBe(600);
    });
    for (let i = 0; i < TICKS_PER_S; i += 1) step(s, []);
    // За вычетом содержания 200 пехоты (0,6/с) — ≈ +0,46.
    s.players.forEach((p, i) => {
      expect(goldPerSecond(before[i] ?? 0, p.gold, 1)).toBeCloseTo(0.46, 1);
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

describe('содержание армий и банкротство', () => {
  const MAP = `
    .  a  a  .
    .  A1 a  .
    .  a  a  .
  `;
  const legend = { A1: city('A', 1, { capital: true }), a: own('A') };

  function empty(): ReturnType<typeof scenario> {
    const s = scenario(MAP, { legend });
    s.state.hexes.pop.fill(0);
    return s;
  }

  it('содержание: пехота 0,003, бронетехника 0,012, артиллерия 0,008 золота/с на солдата', () => {
    const s = empty();
    s.army('A', 'infantry', 1000, at(1, 1));
    s.army('A', 'armor', 100, at(1, 1));
    s.army('A', 'artillery', 100, at(1, 1));
    expect(playerUpkeepPerSecond(s.state, 0)).toBe(3000 + 1200 + 800);
    const before = s.player('A').gold;
    s.runSeconds(1);
    // Город 0,5 − содержание 5,0 = −4,5 золота/с (плюс налог с выросшего за секунду города).
    expect(goldPerSecond(before, s.player('A').gold, 1)).toBeCloseTo(-4.5, 1);
    expect(s.player('A').bankrupt).toBe(false);
  });

  it('казна пуста и баланс отрицательный → банкротство, золото не уходит в минус', () => {
    const s = empty();
    s.army('A', 'infantry', 1000, at(1, 1));
    s.player('A').gold = (1 * 1000) as Fp;
    s.runSeconds(2);
    expect(s.player('A').gold).toBe(0);
    expect(s.player('A').bankrupt).toBe(true);
  });

  it('банкротство блокирует набор и постройки с причиной bankrupt', () => {
    const s = empty();
    s.army('A', 'infantry', 1000, at(1, 1));
    s.player('A').gold = 0 as Fp;
    s.setPop(at(1, 1), 250);
    s.runTicks(1);
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.cmd('A', build(at(2, 1), 'fort'));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['bankrupt', 'bankrupt']);
  });

  it('баланс снова положительный → банкротство снимается', () => {
    const s = empty();
    s.army('A', 'infantry', 100, at(1, 1));
    s.player('A').gold = 0 as Fp;
    s.runTicks(1);
    // Город 0,5 − содержание 0,3 > 0: банкротства нет, золото растёт.
    expect(s.player('A').bankrupt).toBe(false);
    s.runSeconds(1);
    expect(s.player('A').gold).toBeGreaterThan(0);
  });
});
