import { describe, expect, it } from 'vitest';

import { NETWORK_RECALC_TICKS } from '../src/balance.ts';
import { at, city, own, road, scenario } from './scenario/dsl.ts';
import { playerView } from '../src/queries/player-view.ts';
import { hashState } from '../src/state/hash.ts';

const MAP = `
  a  a  a  a  a  a  a  a  a
  a  A1 r  r  r  r  A2 a  a
  a  a  a  a  a  a  a  a  a
`;
const legend = { A1: city('A', 1, { capital: true }), A2: city('A', 1), a: own('A'), r: road('A') };

describe('playerView', () => {
  it('содержит гексы, города, игроков, стройки и связь дорог', () => {
    const s = scenario(MAP, { legend });
    s.runTicks(1);
    const v = playerView(s.state, 0);
    expect(v.tick).toBe(1);
    expect(v.playerId).toBe(0);
    expect(v.hexes.owner).toHaveLength(27);
    expect(v.cities.map((c) => c.isolated)).toEqual([false, false]);
    expect(v.players[0]).toMatchObject({ id: 0, gold: s.player('A').gold });
    // Узлы основной сети — 1, изолированной — 2, не узел — 0.
    expect(v.hexes.link[2 + 1 * 9]).toBe(1);
    expect(v.hexes.link[0]).toBe(0);
  });

  it('помечает изолированные узлы и города', () => {
    const s = scenario(MAP, { legend });
    s.setOwner(at(4, 1), null);
    s.runTicks(NETWORK_RECALC_TICKS);
    const v = playerView(s.state, 0);
    expect(v.cities.find((c) => c.hex === 6 + 1 * 9)?.isolated).toBe(true);
    expect(v.hexes.link[5 + 1 * 9]).toBe(2);
  });

  it('отдаёт копии: изменение снимка не трогает состояние', () => {
    const s = scenario(MAP, { legend });
    const before = hashState(s.state);
    const v = playerView(s.state, 0);
    v.hexes.owner[0] = 5;
    v.hexes.pop[0] = 1;
    expect(hashState(s.state)).toBe(before);
  });
});
