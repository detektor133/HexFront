import { describe, expect, it } from 'vitest';

import { FP } from '../../src/math/int.ts';
import { playerPlace } from '../../src/queries/score.ts';
import { citySupply } from '../../src/state/supply.ts';
import { playerIncomePerSecond } from '../../src/systems/economy.ts';
import { at, city, own, road, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 2),
  A3: city('A', 1),
  a: own('A'),
  r: road('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
  N1: city(null, 1),
};

describe('выработка захваченного города', () => {
  it('золото и снабжение города: 25 % после захвата, линейно до 100 % за 60 с', () => {
    const s = scenario(
      `
      A1 r  r  r  B1
    `,
      { legend },
    );
    s.capture(at(4, 0), 'A');
    const c = s.cityAt(at(4, 0));
    if (!c) throw new Error('нет города');
    s.runTicks(10);
    // Город ур. 1 без столицы: снабжение 250 × 0,25 (+1 % роста за 1 с).
    expect(citySupply(s.state, c)).toBeGreaterThanOrEqual(62_500);
    expect(citySupply(s.state, c)).toBeLessThan(70_000);
    s.runSeconds(29);
    // Половина рампы: 25 % + 75 % × 0,5 = 62,5 %.
    expect(citySupply(s.state, c)).toBe(fpShare(250, 625));
    s.runSeconds(30);
    expect(citySupply(s.state, c)).toBe(250 * FP);
  });
});

describe('перенос столицы', () => {
  it('потеря столицы → самый населённый город крупнейшей сети, 30 с смуты: доход ×0,5', () => {
    const s = scenario(
      `
      A1 r  A2 r  r  A3 b  B1
    `,
      { legend },
    );
    s.setPop(at(2, 0), 200);
    s.setPop(at(5, 0), 250);
    s.runTicks(1);
    const before = playerIncomePerSecond(s.state, 0);
    // После потери A1 города A2 и A3 в одной сети (через дороги); A3 населённее.
    s.setOwner(at(0, 0), 'B');
    s.runTicks(1);
    const capital = s.state.cities.find((c) => c.id === s.player('A').capitalCityId);
    expect(capital?.hex).toBe(5);
    expect(s.lastEvent('capitalMoved')).toBeDefined();
    s.runTicks(10);
    const chaos = playerIncomePerSecond(s.state, 0);
    expect(chaos).toBeLessThan(before);
    s.runSeconds(30);
    expect(s.player('A').chaosTicks).toBe(0);
  });
});

describe('выбывание', () => {
  it('нет городов и нет отрядов → выбыл сразу, территория нейтральна', () => {
    const s = scenario(
      `
      A1 a  b  B1
    `,
      { legend },
    );
    s.setOwner(at(3, 0), 'A');
    s.runTicks(1);
    expect(s.player('B').status).toBe('eliminated');
    expect(s.owner(at(2, 0))).toBeNull();
    expect(s.lastEvent('playerEliminated')).toBeDefined();
  });

  it('нет городов, но есть отряды → 60 с; не взял город — выбыл, отряды распущены', () => {
    const s = scenario(
      `
      A1 a  b  B1
    `,
      { legend },
    );
    s.unit('B', 'infantry', 100, at(2, 0));
    s.setOwner(at(3, 0), 'A');
    s.runSeconds(59);
    expect(s.player('B').status).toBe('alive');
    s.runSeconds(2);
    expect(s.player('B').status).toBe('eliminated');
    expect(s.unitsOf('B')).toHaveLength(0);
  });

  it('взял город за 60 с — остаётся в игре, город становится столицей', () => {
    const s = scenario(
      `
      A1 a  b  B1 N1
    `,
      { legend },
    );
    s.unit('B', 'infantry', 100, at(2, 0));
    s.setOwner(at(3, 0), 'A');
    s.runSeconds(10);
    s.capture(at(4, 0), 'B');
    s.runSeconds(60);
    expect(s.player('B').status).toBe('alive');
    expect(s.state.cities.find((c) => c.id === s.player('B').capitalCityId)?.hex).toBe(4);
  });

  it('места выбывших — по порядку выбывания: выбывший раньше — ниже', () => {
    const s = scenario(
      `
      A1 a  B1 ~  C1 c
    `,
      { legend: { ...legend, C1: city('C', 1, { capital: true }), c: own('C') } },
    );
    s.setOwner(at(2, 0), 'A');
    s.runTicks(1);
    s.setOwner(at(4, 0), 'A');
    s.runTicks(1);
    expect(playerPlace(s.state, 0)).toBe(1);
    expect(playerPlace(s.state, 2)).toBe(2);
    expect(playerPlace(s.state, 1)).toBe(3);
  });
});

describe('победа', () => {
  it('≥ 70 % городов 60 с подряд', () => {
    const s = scenario(
      `
      A1 r  A2 r  A3 ~  B1 b
    `,
      { legend },
    );
    // У A 3 города из 4 — 75 %.
    s.runSeconds(59);
    expect(s.state.winner).toBe(-1);
    s.runSeconds(2);
    expect(s.state.winner).toBe(0);
    expect(s.lastEvent('matchWon')).toMatchObject({ playerId: 0, reason: 'cities' });
  });

  it('потеря доли городов сбрасывает отсчёт', () => {
    const s = scenario(
      `
      A1 r  A2 r  A3 ~  B1 b
    `,
      { legend },
    );
    s.runSeconds(40);
    s.setOwner(at(4, 0), 'B');
    s.runTicks(1);
    s.setOwner(at(4, 0), 'A');
    s.runSeconds(40);
    expect(s.state.winner).toBe(-1);
  });

  it('остальные игроки выбыли — победа', () => {
    const s = scenario(
      `
      A1 a  b  B1 ~  N1 ~  .  N1
    `,
      { legend },
    );
    s.setOwner(at(3, 0), 'A');
    s.runTicks(1);
    expect(s.state.winner).toBe(0);
    expect(s.lastEvent('matchWon')).toMatchObject({ reason: 'lastStanding' });
  });

  it('таймер 25:00 — победа по очкам', () => {
    const s = scenario(
      `
      A1 a  a  N1 ~  N1 ~  B1 ~  N1
    `,
      { legend },
    );
    s.setTick(1500 * 10 - 1);
    s.runTicks(1);
    expect(s.state.winner).toBe(0);
    expect(s.lastEvent('matchWon')).toMatchObject({ reason: 'score' });
  });
});

function fpShare(whole: number, share: number): number {
  return (whole * FP * share) / 1000;
}
