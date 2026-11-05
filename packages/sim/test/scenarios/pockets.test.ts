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
    s.runSeconds(50);
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

  it('котёл в углу карты закрывается так же: край карты не делает его «открытым»', () => {
    const corner = `
      b  b  a  a  a  a  a  a  b  b  b  B1
      b  b  a  a  a  a  a  a  b  b  b  b
      a  a  a  a  a  a  a  a  b  b  b  b
      A1 a  a  a  a  a  a  a  b  b  b  b
    `;
    const s = scenario(corner, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [1, 2, 3]) s.unit('A', 'infantry', 200, at(4, row));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    expect(s.owner(at(0, 0))).toBe('B');
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 600 } },
    ]);
    s.runSeconds(40);
    for (const [c, r] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      expect(s.owner(at(c, r))).toBe('A');
    }
  });

  it('котёл с вражеским отрядом внутри берётся группой, а не держится рядом', () => {
    const corner = `
      b  b  a  a  a  a  a  a  b  b  b  B1
      b  b  a  a  a  a  a  a  b  b  b  b
      a  a  a  a  a  a  a  a  b  b  b  b
      A1 a  a  a  a  a  a  a  b  b  b  b
    `;
    const s = scenario(corner, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [1, 2, 3]) s.unit('A', 'infantry', 300, at(4, row));
    s.unit('B', 'infantry', 100, at(1, 0));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 900 } },
    ]);
    s.runSeconds(60);
    expect(s.owner(at(0, 0))).toBe('A');
    expect(s.owner(at(1, 0))).toBe('A');
  });
});
