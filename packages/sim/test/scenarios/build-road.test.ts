import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  a  a  a  A2 b  B1
  a  a  a  a  a  a  a  a  b  b
  a  a  a  a  a  a  a  a  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('дорога вручную', () => {
  it('соединяет два своих города по своей земле и списывает золото', () => {
    const s = scenario(MAP, { legend });
    const player = s.state.players[0];
    if (!player) throw new Error('нет игрока');
    const gold = player.gold;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: [0, 7] } }]);
    expect(player.gold).toBeLessThan(gold);
    expect(s.state.constructions.some((c) => c.kind === 'road' && c.manual === true)).toBe(true);
    s.runSeconds(60);
    expect(s.state.hexes.road[3]).toBe(1);
    expect(s.state.constructions.some((c) => c.kind === 'road')).toBe(false);
  });

  it('начало и конец — только город или склад, чужая земля и повтор отклоняются', () => {
    const s = scenario(MAP, { legend });
    const w = s.state.map.width;
    const player = s.state.players[0];
    if (!player) throw new Error('нет игрока');
    const gold = player.gold;
    // Конец дороги не узел.
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: [0, 4 + w] } }]);
    // Точка на чужой земле.
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: [0, 9 + w] } }]);
    expect(player.gold).toBe(gold);
    expect(s.state.constructions.length).toBe(0);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: [0, 7] } }]);
    s.runSeconds(60);
    const after = player.gold;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: [0, 7] } }]);
    expect(player.gold).toBe(after);
  });

  it('промежуточная точка задаёт форму: дорога проходит через неё', () => {
    const s = scenario(MAP, { legend });
    const w = s.state.map.width;
    const via = 4 + 2 * w;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: [0, via, 7] } }]);
    s.runSeconds(80);
    expect(s.state.hexes.road[via]).toBe(1);
  });
});
