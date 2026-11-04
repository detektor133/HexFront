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
  });
});
