// Армии под фронты (gdd/09-bots.md): когда кусков границы с врагами больше свободных армий, крупная
// армия бота делится пополам; мелкая и армия экспансии не делятся, лёгкий бот держит две армии.
import { describe, expect, it } from 'vitest';

import { BOT_PROFILES } from '../../src/balance.ts';
import { frontSplit } from '../../src/bots/commander-split.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { assignUnits, at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
`;

type S = ReturnType<typeof scenario>;

// Армия A с auto: n отрядов по soldiers; ей ставят фронт, как commander.
function army(s: S, n: number, soldiers: number): number {
  const ids = Array.from({ length: n }, () => s.unit('A', 'infantry', soldiers, at(2, 2)));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const id = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(ids, id), 'auto');
  s.runTicks(1);
  return id;
}

function viewWithFront(s: S, armyId: number) {
  s.state.plans.push({ armyId, kind: 'front', edges: [], lost: [] } as never);
  return playerView(s.state, 0);
}

describe('frontSplit: армии под фронты', () => {
  it('больше кусков, чем армий, — крупная армия делится', () => {
    const s = scenario(FIELD, { legend });
    const id = army(s, 4, 300);
    const view = viewWithFront(s, id);
    const free = view.armies.filter((a) => a.auto).length;
    const out = frontSplit(view, free + 1, false, BOT_PROFILES.medium);
    expect(out).toEqual([{ t: 'splitArmy', armyId: id }]);
  });

  it('хватает армий — не делится; мелкая армия — не делится', () => {
    const s = scenario(FIELD, { legend });
    const id = army(s, 4, 300);
    const view = viewWithFront(s, id);
    const free = view.armies.filter((a) => a.auto).length;
    expect(frontSplit(view, free, false, BOT_PROFILES.medium)).toEqual([]);
    const s2 = scenario(FIELD, { legend });
    const small = army(s2, 4, 20);
    expect(frontSplit(viewWithFront(s2, small), 9, false, BOT_PROFILES.medium)).toEqual([]);
  });

  it('предел армий профиля: у лёгкого бота их не больше двух', () => {
    const s = scenario(FIELD, { legend });
    const id = army(s, 4, 300);
    const view = viewWithFront(s, id);
    expect(view.armies.length).toBeGreaterThanOrEqual(BOT_PROFILES.easy.maxArmies - 1);
    const full = { ...BOT_PROFILES.easy, maxArmies: view.armies.length };
    expect(frontSplit(view, 9, false, full)).toEqual([]);
  });

  it('пока новая армия без участка, ещё одну не делят', () => {
    const s = scenario(FIELD, { legend });
    army(s, 4, 300);
    const view = playerView(s.state, 0);
    expect(frontSplit(view, 9, false, BOT_PROFILES.medium)).toEqual([]);
  });
});
