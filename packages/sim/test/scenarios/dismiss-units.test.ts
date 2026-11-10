import { describe, expect, it } from 'vitest';

import { applyCommands, validate } from '../../src/commands/apply.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  b  B1
  a  a  a  a  b  b
  a  a  a  a  b  b
`;
const legend = {
  A1: city('A', 3, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const popOf = (s: ReturnType<typeof scenario>): number =>
  s.state.hexes.pop.reduce((sum, p, id) => sum + (s.state.hexes.owner[id] === 0 ? p : 0), 0);

describe('роспуск резерва', () => {
  it('отряд резерва исчезает, а его солдаты возвращаются в население', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const id = s.unit('A', 'infantry', 200, at(2, 1));
    const before = popOf(s);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'dismissUnits', unitIds: [id] } }]);
    expect(s.state.units.some((u) => u.id === id)).toBe(false);
    expect(popOf(s) - before).toBe(200_000);
  });

  it('отряд армии и чужой отряд не распускаются', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const mine = s.unit('A', 'infantry', 200, at(2, 1));
    const theirs = s.unit('B', 'infantry', 200, at(4, 1));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: 'Строй' } }]);
    const army = s.state.armies.find((a) => a.owner === 0);
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'assignUnits', unitIds: [mine], armyId: army?.id ?? -1 } },
    ]);
    expect(validate(s.state, 0, { t: 'dismissUnits', unitIds: [mine] }).ok).toBe(false);
    expect(validate(s.state, 0, { t: 'dismissUnits', unitIds: [theirs] }).ok).toBe(false);
  });
});
