import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

// Оторванный от столицы кусок B (2 гекса) стоит у чужой большой земли C (больше 60 гексов): как
// «дыра» в своей земле A он не считается, но от столицы B оторван — это котёл.
const MAP = `
  A1 a  a  a  a  a  b  b  b  B1
  a  a  a  a  a  a  b  b  b  b
  a  a  a  a  a  a  b  b  b  b
  a  a  b  b  a  a  c  c  c  c
  c  c  c  c  c  c  c  c  c  c
  c  c  c  c  c  c  c  c  c  c
  c  c  c  c  c  c  c  c  c  c
  c  c  c  c  c  c  c  c  c  c
  c  c  c  c  c  c  c  c  c  C1
  c  c  c  c  c  c  c  c  c  c
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
  C1: city('C', 1, { capital: true }),
  c: own('C'),
};

describe('оторванные от столицы куски врага', () => {
  it('кусок у большой чужой земли — тоже котёл, наступающая армия его берёт', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [1, 2, 3]) s.unit('A', 'infantry', 200, at(4, row));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    expect(s.owner(at(2, 3))).toBe('B');
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 600 } },
    ]);
    s.runSeconds(50);
    expect(s.owner(at(2, 3))).toBe('A');
    expect(s.owner(at(3, 3))).toBe('A');
  });
});
