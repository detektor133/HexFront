import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { allocate } from '../../src/state/allocate.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const ROW = 'a  a  a  a  b  b  b  b  b  b';
const MAP = [
  'A1 a  a  a  b  b  b  b  b  b',
  ...Array.from({ length: 10 }, () => ROW),
  'a  a  a  a  b  b  b  b  b  B1',
].join('\n');
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('упреждающая угроза на линии', () => {
  it('враг в двух-трёх гексах от участка делает его весомее, чем тихий участок', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    s.unit('A', 'infantry', 300, at(2, 5));
    // Сильный отряд врага в трёх гексах от границы напротив строки 5; граница — столбец 3.
    s.unit('B', 'infantry', 900, at(6, 5));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 300 } }]);
    const army = s.state.armies.find((a) => a.owner === 0);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    if (plan?.kind !== 'front') throw new Error('нет фронта');
    const { weight } = allocate(s.state, plan, 0);
    const w = s.state.map.width;
    const quiet = weight.get(3 + 1 * w) ?? 0;
    const threatened = weight.get(3 + 5 * w) ?? 0;
    expect(threatened).toBeGreaterThan(quiet);
  });
});
