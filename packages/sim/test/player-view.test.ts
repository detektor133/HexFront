import { describe, expect, it } from 'vitest';

import { NETWORK_RECALC_TICKS } from '../src/balance.ts';
import { at, city, own, recruit, road, scenario } from './scenario/dsl.ts';
import type { Fp } from '../src/math/int.ts';
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

  it('сводка игрока для верхней полосы: население, прирост, доход, эффект выбранного налога, место', () => {
    const s = scenario(MAP, { legend });
    s.state.hexes.pop.fill(0);
    s.setPop(at(0, 0), 100);
    s.player('A').taxTarget = 400 as Fp;
    const me = playerView(s.state, 0).me;
    expect(me.popTotal).toBe(100_000);
    // Доход: 100 чел. × 20 % × 0,01 = 0,2 + 2 города × 0,5 = 1,2; при 40 % — 1,4.
    expect(me.incomePerS).toBe(1200);
    expect(me.incomeAtTargetPerS).toBe(1400);
    expect(me.growthMultAtTarget).toBe(500);
    expect(me.popGrowthPerS).toBeGreaterThan(0);
    // Очки (08-match.md): 2 города × 10 + 27 своих гексов, армий нет.
    expect(me.score).toBe(2 * 10 + 27);
    expect(me.place).toBe(1);
    expect(me.players).toBe(1);
    expect(me.upkeepPerS).toBe(0);
    expect(me.bankrupt).toBe(false);
  });

  it('содержание армий и свои наборы в очереди', () => {
    const s = scenario(MAP, { legend });
    s.army('A', 'infantry', 100, at(0, 0));
    s.player('A').gold = (1000 * 1000) as Fp;
    s.setPop(at(1, 1), 250);
    s.setPop(at(6, 1), 250);
    s.cmd('A', recruit(at(1, 1), 'infantry', 50));
    s.cmd('A', recruit(at(6, 1), 'artillery', 100));
    s.runTicks(1);
    const v = playerView(s.state, 0);
    // 100 пехоты × 0,003 = 0,3 золота/с.
    expect(v.me.upkeepPerS).toBe(300);
    expect(v.recruits.map((r) => [r.cityId, r.type, r.soldiers, r.progressTicks])).toEqual([
      [s.cityAt(at(1, 1))?.id, 'infantry', 50_000, 1],
      [s.cityAt(at(6, 1))?.id, 'artillery', 100_000, 1],
    ]);
  });
});
