import { describe, expect, it } from 'vitest';

import { decide } from '../../src/bots/commander.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { touchLayer } from '../../src/state/layers.ts';
import { at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

// Отряд A зашёл вглубь земли B и отрезан от своей земли: вокруг вражеские гексы.
const MAP = `
  A1 a  a  a  b  b  b  b  B1
  a  a  a  a  b  b  b  b  b
`;
const legend = {
  A1: city('A', 3, { capital: true }),
  a: own('A'),
  B1: city('B', 2, { capital: true }),
  b: own('B'),
};

function setup(foe: boolean) {
  const s = scenario(MAP, { legend });
  const mine = s.unit('A', 'infantry', 300, at(6, 0));
  if (foe) s.unit('B', 'infantry', 100, at(5, 0));
  s.cmd('A', createArmy('Первая'));
  s.runTicks(1);
  const army = s.state.armies.find((a) => a.owner === 0);
  const unit = s.unitById(mine);
  if (!army || !unit) throw new Error('нет армии или отряда');
  unit.armyId = army.id;
  unit.encircled = true;
  return { s, army, mine };
}

describe('commander: прорыв из окружения', () => {
  it('окружённый отряд бьёт в сторону своей земли, а не ждёт гибели', () => {
    const { s, army, mine } = setup(true);
    const out = decide(s.state.map, playerView(s.state, 0), army.id);
    const toward = 5;
    expect(out).toContainEqual({ t: 'attack', unitIds: [mine], target: toward });
  });

  it('без врага рядом отряд без снабжения не прорывается: это не окружение', () => {
    const { s, army } = setup(false);
    s.state.hexes.owner.fill(0);
    touchLayer(s.state, 'owner');
    const out = decide(s.state.map, playerView(s.state, 0), army.id);
    expect(out.some((c) => c.t === 'attack')).toBe(false);
  });
});
