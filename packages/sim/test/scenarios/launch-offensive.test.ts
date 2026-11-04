import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { validate } from '../../src/commands/apply.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  b  b  b  B1
  a  a  a  a  b  b  b  b
  a  a  a  a  b  b  b  b
  a  a  a  a  b  b  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

function game() {
  const s = scenario(MAP, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  for (const row of [0, 1, 2, 3]) s.unit('A', 'infantry', 300, at(2, row));
  return s;
}

describe('наступление одной командой', () => {
  it('в мире отклоняется: нужна война', () => {
    const s = game();
    expect(validate(s.state, 0, { t: 'launchOffensive', target: 1, soldiers: 600 })).toEqual({
      ok: false,
      reason: 'notEnemy',
    });
  });

  it('на войне армия набирает отряды под заказ, ставит фронт и запускает наступление', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    const cmd = { t: 'launchOffensive', target: 1, soldiers: 600 } as const;
    expect(validate(s.state, 0, cmd).ok).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd }]);

    const army = s.state.armies.find((a) => a.owner === 0);
    expect(army).toBeDefined();
    const units = s.state.units.filter((u) => u.armyId === army?.id);
    expect(units.reduce((sum, u) => sum + u.soldiers, 0)).toBeGreaterThanOrEqual(600_000);
    expect(units.length).toBeLessThan(4);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    expect(plan?.kind === 'front' && plan.offensive?.active).toBe(true);
    expect(army?.auto).toBe(false);
  });

  it('держать границу можно и в мире: фронт и заказ без наступления', () => {
    const s = game();
    const cmd = { t: 'holdBorder', target: 1, soldiers: 600 } as const;
    expect(validate(s.state, 0, cmd).ok).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd }]);

    const army = s.state.armies.find((a) => a.owner === 0);
    expect(army?.wanted).toBe(600);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    expect(plan?.kind).toBe('front');
    expect(plan?.kind === 'front' && plan.offensive).toBeNull();
  });

  it('ничья земля тоже направление: фронт на границе у гекса клика и наступление без войны', () => {
    const open = `
      A1 a  a  .  .  .
      a  a  a  .  .  .
      a  a  a  .  .  B1
    `;
    const s = scenario(open, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [0, 1, 2]) s.unit('A', 'infantry', 300, at(2, row));
    const hex = at(4, 1).col + at(4, 1).row * s.state.map.width;
    const cmd = { t: 'launchOffensive', target: -1, soldiers: 300, hex } as const;
    expect(validate(s.state, 0, cmd).ok).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd }]);

    const army = s.state.armies.find((a) => a.owner === 0);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    expect(plan?.kind === 'front' && plan.offensive?.active).toBe(true);
  });

  it('удар по ничьей земле — участок у клика, а не кольцо по всей границе; новый клик его переставляет', () => {
    const wide = `
      .  .  .  .  .  .  .  .  .  .  .
      .  a  a  a  a  a  a  a  a  a  .
      .  a  a  a  a  a  a  a  a  a  .
      .  a  a  A1 a  a  a  a  a  a  .
      .  a  a  a  a  a  a  a  a  a  .
      .  a  a  a  a  a  a  a  a  a  .
      .  .  .  .  .  .  .  .  .  .  B1
    `;
    const s = scenario(wide, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [1, 2, 3, 4, 5]) s.unit('A', 'infantry', 300, at(5, row));
    const width = s.state.map.width;
    const click = (col: number, row: number): number => at(col, row).col + at(col, row).row * width;
    const cmd = { t: 'launchOffensive', target: -1, soldiers: 300, hex: click(10, 0) } as const;
    applyCommands(s.state, [{ playerId: 0, cmd }]);

    const army = s.state.armies.find((a) => a.owner === 0);
    const first = s.state.plans.find((p) => p.armyId === army?.id);
    const edges = first?.kind === 'front' ? [...first.edges] : [];
    expect(edges.length).toBeGreaterThan(0);
    // Вся своя граница с ничьей землёй заметно длиннее участка удара.
    expect(edges.length).toBeLessThanOrEqual(2 * 12 + 1);
    expect(edges.length).toBeLessThan(30);

    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: -1, soldiers: 300, hex: click(0, 6) } },
    ]);
    const second = s.state.plans.find((p) => p.armyId === army?.id);
    const moved = second?.kind === 'front' ? [...second.edges] : [];
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.some((e) => !edges.includes(e))).toBe(true);
  });

  it('0 солдат снимает направление: фронт убран, отряды в резерве, армия расформирована', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 600 } }]);
    expect(s.state.armies.some((a) => a.owner === 0)).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 0 } }]);

    expect(s.state.armies.some((a) => a.owner === 0)).toBe(false);
    expect(s.state.plans).toHaveLength(0);
    expect(s.state.units.filter((u) => u.owner === 0).every((u) => u.armyId === null)).toBe(true);
  });
});
