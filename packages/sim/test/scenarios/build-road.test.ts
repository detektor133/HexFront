import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  a  a  a  a  b  B1
  a  a  a  a  a  a  a  a  b  b
  a  a  a  a  a  a  a  a  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('дорога вручную', () => {
  it('прокладывается от точки к точке по своей земле и списывает золото', () => {
    const s = scenario(MAP, { legend });
    const w = s.state.map.width;
    const player = s.state.players[0];
    if (!player) throw new Error('нет игрока');
    const gold = player.gold;
    const from = 0 + 2 * w;
    const to = 7 + 2 * w;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: [from, to] } }]);
    expect(player.gold).toBeLessThan(gold);
    expect(s.state.constructions.some((c) => c.kind === 'road' && c.manual === true)).toBe(true);
    s.runSeconds(60);
    expect(s.state.hexes.road[from]).toBe(1);
    expect(s.state.hexes.road[to]).toBe(1);
    expect(s.state.constructions.some((c) => c.kind === 'road')).toBe(false);
  });

  it('точка на чужой земле отклоняется, повтор по готовой дороге — тоже', () => {
    const s = scenario(MAP, { legend });
    const w = s.state.map.width;
    const player = s.state.players[0];
    if (!player) throw new Error('нет игрока');
    const gold = player.gold;
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'buildRoad', points: [0 + 2 * w, 9 + 2 * w] } },
    ]);
    expect(player.gold).toBe(gold);
    expect(s.state.constructions.length).toBe(0);
    const path = [1 + w, 3 + w];
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: path } }]);
    s.runSeconds(30);
    const after = player.gold;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'buildRoad', points: path } }]);
    expect(player.gold).toBe(after);
  });

  it('точки заданы: ломаная через промежуточную точку проходит через неё', () => {
    const s = scenario(MAP, { legend });
    const w = s.state.map.width;
    const via = 4 + 2 * w;
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'buildRoad', points: [0 + 0 * w, via, 7 + 0 * w] } },
    ]);
    s.runSeconds(80);
    expect(s.state.hexes.road[via]).toBe(1);
  });
});
