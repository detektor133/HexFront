import { describe, expect, it } from 'vitest';

import { decide } from '../../src/bots/commander.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  a  .  .  B1
  a  a  a  a  a  .  .  b
`;
const legend = {
  A1: city('A', 3, { capital: true }),
  a: own('A'),
  B1: city('B', 2, { capital: true }),
  b: own('B'),
};

// Армия A с отрядами; бот сам решает, идти ли на вражескую столицу, по прогнозу боя.
function setup(ownSoldiers: number, enemySoldiers: number) {
  const s = scenario(MAP, { legend });
  const mine = s.unit('A', 'infantry', ownSoldiers, at(4, 0));
  if (enemySoldiers > 0) s.unit('B', 'infantry', enemySoldiers, at(7, 0));
  s.cmd('A', createArmy('Первая'));
  s.runTicks(1);
  const army = s.state.armies.find((a) => a.owner === 0);
  const unit = s.unitById(mine);
  if (!army || !unit) throw new Error('нет армии или отряда');
  unit.armyId = army.id;
  const view = playerView(s.state, 0);
  return { s, view, army, mine };
}

describe('commander: удар по городу', () => {
  it('отряд идёт на вражескую столицу, если прогноз — победа (город пуст или слаб)', () => {
    const { s, view, army, mine } = setup(3000, 0);
    const out = decide(s.state.map, view, army.id, undefined, undefined, true);
    const cityHex = s.state.cities.find((c) => c.owner === 1)?.hex;
    expect(out).toContainEqual({ t: 'move', unitIds: [mine], to: cityHex });
  });

  it('при прогнозе не «победа» бот на город не идёт, а человек никогда не атакует сам', () => {
    const strong = setup(40, 900);
    const hex = strong.s.state.cities.find((c) => c.owner === 1)?.hex;
    const botOut = decide(
      strong.s.state.map,
      strong.view,
      strong.army.id,
      undefined,
      undefined,
      true,
    );
    expect(botOut.some((c) => c.t === 'move' && c.to === hex)).toBe(false);
    const weak = setup(3000, 0);
    const humanOut = decide(weak.s.state.map, weak.view, weak.army.id);
    const hexWeak = weak.s.state.cities.find((c) => c.owner === 1)?.hex;
    expect(humanOut.some((c) => c.t === 'move' && c.to === hexWeak)).toBe(false);
  });
});
