import { describe, expect, it } from 'vitest';

import { createBotTickContext } from '../../src/bots/context.ts';
import { seaCommands } from '../../src/bots/sea.ts';
import { applyCommands } from '../../src/commands/apply.ts';
import { withDepot } from '../../src/state/building.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

// Остров A и остров B далеко друг от друга за морем.
const MAP = `
  A1 a  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  b  B1
  a  a  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  b  b
  a  a  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('бот высаживается за морем', () => {
  it('воюющий бот с армией в порту отправляет вторжение на берег врага', () => {
    const s = scenario(MAP, { legend });
    const w = s.state.map.width;
    s.state.hexes.building[1 + w] = withDepot(0, 1);
    for (let i = 0; i < 4; i += 1) s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', { t: 'createArmy', name: '' });
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    const ids = s.state.units.filter((u) => u.owner === 0 && u.hex === 1 + w).map((u) => u.id);
    s.cmd('A', { t: 'assignUnits', units: ids, armyId: army });
    s.runTicks(2);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    const player = s.state.players[0];
    if (player) player.gold = (50_000 * 1000) as typeof player.gold;
    // Тик подгоняется под расписание бота.
    s.state.tick = Math.ceil(s.state.tick / 600) * 600;
    const cmds = seaCommands(s.state, 0, createBotTickContext(s.state));
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ t: 'invade', armyId: army, from: 1 + w });
  });
});
