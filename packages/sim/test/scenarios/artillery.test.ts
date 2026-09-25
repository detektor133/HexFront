import { describe, expect, it } from 'vitest';

import { FP } from '../../src/math/int.ts';
import { battlePowers } from '../../src/systems/combat.ts';
import { at, attack, bombard, city, own, road, scenario, type At } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  A5: city('A', 5, { capital: true }),
  a: own('A'),
  r: road('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const hexOf = (s: ReturnType<typeof scenario>, w: At): number => w.col + w.row * s.state.map.width;

// Дорога A до (3,1), дальше земля B; по краям вода.
const LINE = `
  ~  ~  ~  ~  ~  ~  ~  ~
  A1 r  r  r  b  b  b  B1
  ~  ~  ~  ~  ~  ~  ~  ~
`;

describe('обстрел', () => {
  it('урон в секунду: солдаты × 0,004 × снабжение, org — солдаты × 0,002', () => {
    const s = scenario(LINE, { legend });
    // 300 × 1,5 = 450 снабжения из 500 столицы — снабжение 100 %.
    s.unit('A', 'artillery', 300, at(3, 1));
    const target = s.unit('B', 'infantry', 500, at(5, 1));
    s.runTicks(10);
    const u = s.unitById(target);
    // 300 × 0,004 × (0,5 + 0,5 × 1) = 1,2 солдата за секунду; org — 0,6 за секунду.
    expect(500 * FP - (u?.soldiers ?? 0)).toBe(1200);
    expect(100 * FP - (u?.org ?? 0)).toBe(600);
  });

  it('радиус 2: отряд в 3 гексах не обстреливается', () => {
    const s = scenario(LINE, { legend });
    s.unit('A', 'artillery', 1000, at(3, 1));
    const far = s.unit('B', 'infantry', 500, at(6, 1));
    s.runSeconds(3);
    expect(s.unitById(far)?.soldiers).toBe(500 * FP);
  });

  it('автоцель: сначала тот, кто атакует наш гекс', () => {
    const s = scenario(LINE, { legend });
    s.unit('A', 'artillery', 1000, at(2, 1));
    s.unit('A', 'infantry', 100, at(3, 1));
    const attacker = s.unit('B', 'infantry', 100, at(4, 1));
    s.unit('B', 'infantry', 900, at(4, 1));
    s.cmd('B', attack([attacker], at(3, 1)));
    s.runTicks(1);
    const art = s.unitsOf('A')[0];
    expect(art?.fireTarget).toBe(attacker);
  });

  it('автоцель: иначе самый крупный отряд у нашей границы, затем вражеская артиллерия', () => {
    const s = scenario(LINE, { legend });
    s.unit('A', 'artillery', 1000, at(3, 1));
    const enemyArt = s.unit('B', 'artillery', 900, at(5, 1));
    const small = s.unit('B', 'infantry', 100, at(4, 1));
    const big = s.unit('B', 'infantry', 300, at(4, 1));
    s.runTicks(1);
    expect(s.unitsOf('A')[0]?.fireTarget).toBe(big);
    expect(small).toBeLessThan(big);
    // Без отрядов у границы — по вражеской артиллерии.
    const t = scenario(LINE, { legend });
    t.unit('A', 'artillery', 1000, at(3, 1));
    const art2 = t.unit('B', 'artillery', 900, at(5, 1));
    t.runTicks(1);
    expect(t.unitsOf('A')[0]?.fireTarget).toBe(art2);
    expect(enemyArt).toBeGreaterThan(0);
  });

  it('фокус огня перекрывает автоцель; bombard(null) возвращает автоцель', () => {
    const s = scenario(LINE, { legend });
    const art = s.unit('A', 'artillery', 1000, at(3, 1));
    const big = s.unit('B', 'infantry', 300, at(4, 1));
    const other = s.unit('B', 'infantry', 100, at(5, 1));
    s.cmd('A', bombard(art, other));
    s.runTicks(1);
    expect(s.unitById(art)?.fireTarget).toBe(other);
    s.cmd('A', bombard(art, null));
    s.runTicks(1);
    expect(s.unitById(art)?.fireTarget).toBe(big);
  });

  it('bombard: не артиллерия — badOrder, свой отряд — notEnemy', () => {
    const s = scenario(LINE, { legend });
    const inf = s.unit('A', 'infantry', 100, at(2, 1));
    const art = s.unit('A', 'artillery', 100, at(3, 1));
    const enemy = s.unit('B', 'infantry', 100, at(5, 1));
    s.cmd('A', bombard(inf, enemy));
    s.cmd('A', bombard(art, inf));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['badOrder', 'notEnemy']);
  });
});

describe('поддержка и уязвимость', () => {
  // Столица 5-го уровня (1500 снабжения): батареи не отнимают снабжение у пехоты.
  const RICH = LINE.replace('A1', 'A5');

  function attackWith(batteries: readonly number[]): number {
    const s = scenario(RICH, { legend });
    for (const soldiers of batteries) s.unit('A', 'artillery', soldiers, at(2, 1));
    const inf = s.unit('A', 'infantry', 500, at(3, 1));
    s.unit('B', 'infantry', 5000, at(4, 1));
    s.cmd('A', attack([inf], at(4, 1)));
    s.runTicks(1);
    return battlePowers(s.state, hexOf(s, at(4, 1))).attack;
  }

  it('+30 % к атаке по гексу в радиусе 2 от своей артиллерии (≥ 100 солдат), без сложения', () => {
    const none = attackWith([]);
    const one = attackWith([100]);
    const two = attackWith([100, 500]);
    const weak = attackWith([99]);
    expect(one / none).toBeCloseTo(1.3, 2);
    // Батареи ещё и обстреливают защитника — это чуть меняет потери, поэтому сравнение с допуском.
    expect(two / one).toBeCloseTo(1, 4);
    expect(weak / none).toBeCloseTo(1, 4);
  });

  it('одинокая артиллерия при атаке сразу отступает с −10 %', () => {
    const s = scenario(LINE, { legend });
    const art = s.unit('A', 'artillery', 1000, at(3, 1));
    const enemy = s.unit('B', 'infantry', 100, at(4, 1));
    s.cmd('B', attack([enemy], at(3, 1)));
    s.runTicks(1);
    const u = s.unitById(art);
    expect(u?.order).toBe('retreat');
    expect(u?.hex).toBe(hexOf(s, at(2, 1)));
    expect(u?.soldiers).toBe(900 * FP);
    expect(s.owner(at(3, 1))).toBe('B');
  });

  it('с другими отрядами артиллерия обороняется вместе с ними (оборона 0,6)', () => {
    const s = scenario(RICH, { legend });
    const art = s.unit('A', 'artillery', 300, at(3, 1));
    s.unit('A', 'infantry', 300, at(3, 1));
    const enemy = s.unit('B', 'infantry', 100, at(4, 1));
    s.cmd('B', attack([enemy], at(3, 1)));
    s.runTicks(1);
    expect(s.unitById(art)?.hex).toBe(hexOf(s, at(3, 1)));
    // Оборона: (300 × 0,6 + 300 × 1,2) × снабжение 100 % = 540 (за тик — доли солдата потерь).
    expect(battlePowers(s.state, hexOf(s, at(3, 1))).defense).toBeGreaterThan(539 * FP);
  });
});

describe('регрессии', () => {
  it('атакующий, убитый обстрелом в том же тике, не ломает бой (деление на ноль)', () => {
    const s = scenario(LINE.replace('A1', 'A5'), { legend });
    const att = s.unit('A', 'infantry', 1, at(3, 1));
    s.unit('B', 'infantry', 100, at(4, 1));
    // 3000 × 0,004 × снабжение / 10 ≈ 0,6–1,2 солдата за тик: одиночный солдат гибнет сразу.
    s.unit('B', 'artillery', 3000, at(5, 1));
    s.cmd('A', attack([att], at(4, 1)));
    expect(() => s.runTicks(5)).not.toThrow();
    expect(s.unitById(att)).toBeUndefined();
  });
});
