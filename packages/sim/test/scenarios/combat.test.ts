import { describe, expect, it } from 'vitest';

import { FP, fpMul, type Fp } from '../../src/math/int.ts';
import type { Unit } from '../../src/state/types.ts';
import { battlePowers, flankMultiplier, supplyCombatMult } from '../../src/systems/combat.ts';
import { at, attack, city, move, own, road, scenario, type At } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  r: road('A'),
  B1: city('B', 1, { capital: true }),
  B2: city('B', 1),
  b: own('B'),
  f: { kind: 'own', player: 'B', terrain: 'forest' } as const,
  N1: city(null, 1),
};

const hexOf = (s: ReturnType<typeof scenario>, w: At): number => w.col + w.row * s.state.map.width;

// A слева, B справа; по краям — вода, чтобы соседство было однозначным.
const FIELD = `
  ~  ~  ~  ~  ~  ~
  A1 a  a  b  b  B1
  ~  ~  ~  ~  ~  ~
`;

describe('сила сторон', () => {
  const infantryAttack = (u: Unit | undefined): number =>
    fpMul(u?.soldiers ?? (0 as Fp), supplyCombatMult(u?.supplyLevel ?? (0 as Fp)));
  const infantryDefense = (u: Unit | undefined): number =>
    fpMul(
      fpMul(u?.soldiers ?? (0 as Fp), 1200 as Fp),
      supplyCombatMult(u?.supplyLevel ?? (0 as Fp)),
    );

  it('атака = солдаты × ATK × (0,5 + 0,5 × s); оборона = солдаты × DEF × (0,5 + 0,5 × s) × местность', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 500, at(2, 1));
    const def = s.unit('B', 'infantry', 200, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    s.runTicks(10);
    // Оба в 2 гексах от своих столиц: снабжение 76 % → множитель 0,88.
    expect(s.unitById(att)?.supplyLevel).toBe(760);
    expect(supplyCombatMult(760 as Fp)).toBe(880);
    const p = battlePowers(s.state, hexOf(s, at(3, 1)));
    expect(p.attack).toBe(infantryAttack(s.unitById(att)));
    expect(p.defense).toBe(infantryDefense(s.unitById(def)));
  });

  it('лес ×1,25 и укрепление ×1,4 (множители перемножаются до применения)', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~
      A1 a  f  B1 ~
      ~  ~  ~  ~  ~
    `,
      { legend },
    );
    const att = s.unit('A', 'infantry', 100, at(1, 1));
    const inForest = s.unit('B', 'infantry', 100, at(2, 1));
    s.setBuilding(at(2, 1), 'fort');
    s.cmd('A', attack([att], at(2, 1)));
    s.runTicks(10);
    const forest = battlePowers(s.state, hexOf(s, at(2, 1))).defense;
    expect(forest).toBe(
      fpMul(infantryDefense(s.unitById(inForest)) as Fp, fpMul(1250 as Fp, 1400 as Fp)),
    );
  });

  it('город: ополчение 100 × 1,2 (как пехота) × город 1,3', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 100, at(4, 1));
    s.cmd('A', attack([att], at(5, 1)));
    s.runTicks(1);
    // Замер после тика: ополчение уже потеряло долю солдата.
    const militia = s.cityAt(at(5, 1))?.defenders ?? 0;
    const expected = fpMul(fpMul(militia as Fp, 1200 as Fp), 1300 as Fp);
    expect(battlePowers(s.state, hexOf(s, at(5, 1))).defense).toBe(expected);
    expect(militia).toBeGreaterThan(99 * FP);
  });

  it('множитель флангов: 1 + 0,15 × (направлений − 1), не больше 1,3', () => {
    expect([1, 2, 3, 4, 5, 6].map(flankMultiplier)).toEqual([1000, 1150, 1300, 1300, 1300, 1300]);
  });

  it('атакующие с разных направлений получают фланговый бонус', () => {
    const s = scenario(
      `
      r  r  r
      r  b  r
      r  r  A1
    `,
      { legend },
    );
    const target = at(1, 1);
    s.unit('B', 'infantry', 5000, target);
    const ids = [at(0, 1), at(2, 1)].map((w) => s.unit('A', 'infantry', 100, w));
    s.cmd('A', attack(ids, target));
    s.runTicks(1);
    const units = ids.map((id) => s.unitById(id));
    const sum = units.reduce((acc, u) => acc + infantryAttack(u), 0);
    expect(battlePowers(s.state, hexOf(s, target)).attack).toBe(fpMul(sum as Fp, 1150 as Fp));
  });

  it('атака через реку ×0,7', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 500, at(2, 1));
    s.unit('B', 'infantry', 200, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    s.runTicks(1);
    const dry = battlePowers(s.state, hexOf(s, at(3, 1))).attack;
    // (2,1) — чётный столбец: к (3,1) ведёт направление 1 (NE).
    s.river(at(2, 1), 1);
    const wet = battlePowers(s.state, hexOf(s, at(3, 1))).attack;
    expect(wet).toBe(fpMul(dry as Fp, 700 as Fp));
  });
});

describe('ход боя', () => {
  it('сильный атакующий ломает защитника: тот отступает, атакующий сразу входит', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 600, at(2, 1));
    const def = s.unit('B', 'infantry', 150, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    s.runSeconds(20);
    expect(s.owner(at(3, 1))).toBe('A');
    expect(s.unitById(att)?.hex).toBe(hexOf(s, at(3, 1)));
    expect(s.unitById(def)?.hex).toBe(hexOf(s, at(4, 1)));
    expect(s.lastEvent('unitRetreated')).toBeDefined();
  });

  it('потери идут обеим сторонам, пропорционально силе противника', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 500, at(2, 1));
    const def = s.unit('B', 'infantry', 500, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    s.runSeconds(2);
    const lostA = 500 * FP - (s.unitById(att)?.soldiers ?? 0);
    const lostB = 500 * FP - (s.unitById(def)?.soldiers ?? 0);
    expect(lostA).toBeGreaterThan(0);
    expect(lostB).toBeGreaterThan(0);
    // Оборона пехоты 1,2 против атаки 1,0: атакующий теряет больше.
    expect(lostA).toBeGreaterThan(lostB);
  });

  it('org атакующего = 0 — атака прекращается, отряд остаётся в своём гексе', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 100, at(2, 1));
    s.unit('B', 'infantry', 1000, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    s.runSeconds(15);
    expect(s.unitById(att)?.hex).toBe(hexOf(s, at(2, 1)));
    expect(s.unitById(att)?.order).toBe('idle');
    expect(s.owner(at(3, 1))).toBe('B');
  });

  it('путь move, упёршийся во врага, превращается в атаку', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 600, at(1, 1));
    s.unit('B', 'infantry', 100, at(3, 1));
    s.cmd('A', move([att], at(3, 1)));
    // Шаг в (2,1) рядом с врагом: 2 с × 2 за зону контроля.
    s.runSeconds(5);
    expect(s.unitById(att)?.order).toBe('attack');
    s.runSeconds(20);
    expect(s.owner(at(3, 1))).toBe('A');
  });

  it('attack: цель не враг — отказ notEnemy; артиллерия — badOrder', () => {
    const s = scenario(FIELD, { legend });
    const inf = s.unit('A', 'infantry', 100, at(1, 1));
    const art = s.unit('A', 'artillery', 100, at(2, 1));
    s.unit('B', 'infantry', 100, at(3, 1));
    s.cmd('A', attack([inf], at(2, 1)));
    s.cmd('A', attack([art], at(3, 1)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notEnemy', 'badOrder']);
  });

  it('отряд без солдат уничтожается', () => {
    const s = scenario(FIELD, { legend });
    const att = s.unit('A', 'infantry', 3000, at(2, 1));
    const def = s.unit('B', 'infantry', 1, at(3, 1));
    s.cmd('A', attack([att], at(3, 1)));
    s.runSeconds(2);
    expect(s.unitById(def)).toBeUndefined();
    expect(s.lastEvent('unitDestroyed')).toBeDefined();
  });
});

describe('города: ополчение и гарнизон', () => {
  it('нейтральный город: гарнизон 150 ломается, город захвачен без потерь населения', () => {
    const s = scenario(
      `
      ~  ~  ~  ~
      A1 a  a  N1
      ~  ~  ~  ~
    `,
      { legend },
    );
    const att = s.unit('A', 'infantry', 800, at(2, 1));
    s.cmd('A', attack([att], at(3, 1)));
    s.runSeconds(30);
    expect(s.owner(at(3, 1))).toBe('A');
    expect(s.cityAt(at(3, 1))?.owner).toBe(0);
  });

  it('гарнизон не восстанавливается вне боя', () => {
    const s = scenario(
      `
      ~  ~  ~  ~
      A1 a  a  N1
      ~  ~  ~  ~
    `,
      { legend },
    );
    const att = s.unit('A', 'infantry', 100, at(2, 1));
    s.cmd('A', attack([att], at(3, 1)));
    s.runSeconds(5);
    const after = s.cityAt(at(3, 1))?.defenders ?? 0;
    expect(after).toBeLessThan(150 * FP);
    s.runSeconds(30);
    expect(s.cityAt(at(3, 1))?.defenders).toBeLessThanOrEqual(after);
  });

  it('ополчение защищает город вместе с отрядами и восстанавливается вне боя', () => {
    const s = scenario(FIELD, { legend });
    const b1 = s.cityAt(at(5, 1));
    expect(b1?.defenders).toBe(100 * FP);
    const att = s.unit('A', 'infantry', 300, at(4, 1));
    s.cmd('A', attack([att], at(5, 1)));
    s.runSeconds(3);
    const hurt = s.cityAt(at(5, 1))?.defenders ?? 0;
    expect(hurt).toBeLessThan(100 * FP);
    s.cmd('A', move([att], at(3, 1)));
    s.runSeconds(15);
    expect(s.cityAt(at(5, 1))?.defenders ?? 0).toBeGreaterThan(hurt);
  });

  it('захваченный город у игрока: ополчение с нуля, население −30 %', () => {
    const s = scenario(
      `
      ~  ~  ~  ~  ~
      A1 a  a  B2 b
      ~  ~  ~  ~  ~
    `,
      { legend },
    );
    s.setPop(at(3, 1), 200);
    const att = s.unit('A', 'infantry', 1000, at(2, 1));
    s.cmd('A', attack([att], at(3, 1)));
    for (let i = 0; i < 300 && s.owner(at(3, 1)) !== 'A'; i += 1) s.runTicks(1);
    expect(s.owner(at(3, 1))).toBe('A');
    expect(s.cityAt(at(3, 1))?.defenders).toBe(0);
    // До захвата город рос 3 чел./с несколько секунд: (200 + ~15) × 0,7 ≈ 150.
    expect(s.pop(at(3, 1))).toBeLessThan(160 * FP);
    expect(s.pop(at(3, 1))).toBeGreaterThan(130 * FP);
  });
});
