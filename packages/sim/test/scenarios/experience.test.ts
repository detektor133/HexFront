import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { attackContribution } from '../../src/queries/battle-math.ts';
import { playerView } from '../../src/queries/player-view.ts';
import {
  experienceSystem,
  orgPct,
  powerPct,
  replenishPct,
  starsOf,
} from '../../src/systems/experience.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  b  b  B1
  a  a  a  b  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

function game() {
  const s = scenario(MAP, { legend });
  s.unit('A', 'infantry', 100, at(1, 0));
  applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: '' } }]);
  const army = s.state.armies.find((a) => a.owner === 0);
  if (!army) throw new Error('нет армии');
  for (const u of s.state.units) if (u.owner === 0) u.armyId = army.id;
  return { s, army };
}

describe('опыт армии', () => {
  it('звёзды по опыту: пороги 450, 1800 и 4800 тиков боя', () => {
    expect([0, 449, 450, 1799, 1800, 4799, 4800, 99999].map(starsOf)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it('бонусы звёзд растут и не делают армию непобедимой', () => {
    expect([0, 1, 2, 3].map(powerPct)).toEqual([0, 3, 7, 12]);
    expect([0, 1, 2, 3].map(orgPct)).toEqual([0, 3, 7, 12]);
    expect([0, 1, 2, 3].map(replenishPct)).toEqual([0, 10, 20, 35]);
  });

  it('армия с отрядом в бою получает опыт, а звёзды раздаются всем её отрядам', () => {
    const { s, army } = game();
    army.xp = 449;
    const unit = s.state.units.find((u) => u.armyId === army.id);
    if (!unit) throw new Error('нет отряда');
    unit.inBattle = true;
    experienceSystem(s.state);
    expect(army.xp).toBe(450);
    expect(unit.stars).toBe(1);
  });

  it('новый отряд, прикреплённый к армии, воюет с её звёздами', () => {
    const { s, army } = game();
    army.xp = 4800;
    const newcomer = s.unit('A', 'infantry', 50, at(2, 1));
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'assignUnits', unitIds: [newcomer], armyId: army.id } },
    ]);
    experienceSystem(s.state);
    expect(s.state.units.find((u) => u.id === newcomer)?.stars).toBe(3);
  });

  it('без боя опыт не растёт, резерв без звёзд', () => {
    const { s, army } = game();
    const reserve = s.unit('A', 'infantry', 50, at(2, 1));
    experienceSystem(s.state);
    expect(army.xp ?? 0).toBe(0);
    expect(s.state.units.find((u) => u.id === reserve)?.stars ?? 0).toBe(0);
  });

  it('сила в атаке растёт на бонус звёзд', () => {
    const { s } = game();
    const base = s.state.units[0];
    if (!base) throw new Error('нет отряда');
    const plain = attackContribution(s.state.map, base, 1, s.state.units);
    const veteran = attackContribution(s.state.map, { ...base, stars: 3 }, 1, s.state.units);
    expect(veteran).toBe(Math.trunc((plain * (100 + powerPct(3))) / 100));
  });

  it('звёзды видны в снимке игрока: у армии и у отряда', () => {
    const { s, army } = game();
    army.xp = 1800;
    experienceSystem(s.state);
    const view = playerView(s.state, 0);
    expect(view.armies.find((a) => a.id === army.id)?.stars).toBe(2);
    expect(view.units.find((u) => u.armyId === army.id)?.stars).toBe(2);
  });
});
