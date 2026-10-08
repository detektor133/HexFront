import { describe, expect, it } from 'vitest';

import {
  BOT_ATTACK_MIN_RATIO,
  BOT_ATTACK_STOP_RATIO,
  BOT_GOLD_TARGET,
  BOT_W_FORT,
  BOT_W_ROAD,
  BOT_W_DEFEND,
  BOT_W_FOUND,
  BOT_W_IMPROVE,
  BOT_W_RECRUIT,
  BOT_W_UPGRADE,
} from '../src/balance.ts';
import {
  attackUtility,
  defendUtility,
  defenseNeed,
  fortUtility,
  foundUtility,
  improveUtility,
  pressure,
  rankGoals,
  recruitUtility,
  roadUtility,
  upgradeUtility,
  utility,
} from '../src/bots/goals.ts';
import { fp, fpMul } from '../src/math/int.ts';

describe('цели utility AI бота', () => {
  it('умножает вес цели на фактор в fixed-point', () => {
    expect(utility(BOT_W_DEFEND, fp(0.5))).toBe(fp(0.45));
  });

  it('считает pressure от цели золота и ограничивает его единицей', () => {
    expect(pressure(fp(500))).toBe(0);
    expect(pressure(BOT_GOLD_TARGET)).toBe(0);
    expect(pressure(fp(2250))).toBe(fp(0.5));
    expect(pressure(fp(5000))).toBe(fp(1));
  });

  it('считает оборону и набор по максимальному фактору угрозы', () => {
    const need = fp(0.5);
    expect(defenseNeed(fp(100), fp(30))).toBe(fp(0.5));
    expect(defendUtility(need)).toBe(fpMul(BOT_W_DEFEND, need));
    expect(recruitUtility(need, fp(0.2), fp(0.1))).toBe(fpMul(BOT_W_RECRUIT, need));
  });

  it('включает дорогу только при наличии цели', () => {
    expect(roadUtility(false)).toBe(0);
    expect(roadUtility(true)).toBe(BOT_W_ROAD);
  });

  it('отбрасывает атаку ниже минимального отношения', () => {
    expect(attackUtility(fp(119), fp(100), 3, false)).toBe(0);
    expect(BOT_ATTACK_MIN_RATIO).toBe(fp(1.2));
  });

  it('останавливает активную атаку ниже порога остановки', () => {
    expect(BOT_ATTACK_STOP_RATIO).toBe(fp(0.8));
    expect(attackUtility(fp(79), fp(100), 3, true)).toBe(0);
  });

  it('применяет бонусы уничтожения и текущей цели', () => {
    const base = attackUtility(fp(200), fp(100), 3, false);
    const elimination = attackUtility(fp(200), fp(100), 2, false);
    const sticky = attackUtility(fp(200), fp(100), 3, true);
    expect(elimination).toBe(fpMul(base, fp(1.5)));
    expect(sticky).toBe(fpMul(base, fp(1.25)));
  });

  it('считает цели города с pressure', () => {
    const goldPressure = fp(0.5);
    expect(foundUtility(fp(0.5), goldPressure)).toBe(fpMul(fpMul(BOT_W_FOUND, fp(0.5)), fp(1.5)));
    expect(upgradeUtility(1, goldPressure)).toBe(fpMul(fpMul(BOT_W_UPGRADE, fp(1)), fp(1.5)));
    expect(improveUtility(fp(0.5), goldPressure)).toBe(
      fpMul(fpMul(BOT_W_IMPROVE, fp(0.5)), fp(1.5)),
    );
  });

  it('считает форт по потребности и pressure', () => {
    expect(fortUtility(fp(0.5), fp(0.5))).toBe(fpMul(fpMul(BOT_W_FORT, fp(0.5)), fp(0.5)));
  });

  it('сортирует равные цели по порядку таблицы и id', () => {
    const goals = rankGoals([
      { kind: 'upgrade', utility: fp(0.4), id: 3 },
      { kind: 'road', utility: fp(0.4), id: 9 },
      { kind: 'road', utility: fp(0.4), id: 2 },
      { kind: 'attack', utility: fp(0.5), id: 7 },
    ]);
    expect(goals.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'attack:7',
      'road:2',
      'road:9',
      'upgrade:3',
    ]);
  });
});
