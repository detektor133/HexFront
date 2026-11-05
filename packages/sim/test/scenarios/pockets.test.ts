import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

// Своя земля A слева; посреди неё — котёл из двух гексов B (без отрядов), далеко от основной земли B.
const MAP = `
  A1 a  a  a  a  a  a  a  b  b  b  B1
  a  a  a  a  a  a  a  a  b  b  b  b
  a  a  a  b  b  b  a  a  b  b  b  b
  a  a  a  b  b  b  a  a  b  b  b  b
  a  a  a  a  a  a  a  a  b  b  b  b
  a  a  a  a  a  a  a  a  b  b  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('котлы', () => {
  it('наступающая армия закрывает котёл внутри своей земли, не дожидаясь линии наступления', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [0, 1, 4, 5]) s.unit('A', 'infantry', 200, at(1, row));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    expect(s.owner(at(4, 2))).toBe('B');
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 800 } },
    ]);
    s.runSeconds(25);
    for (const [c, r] of [
      [3, 2],
      [4, 2],
      [5, 2],
      [3, 3],
      [4, 3],
      [5, 3],
    ] as const) {
      expect(s.owner(at(c, r))).toBe('A');
    }
  });
});
