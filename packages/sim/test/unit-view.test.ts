import { describe, expect, it } from 'vitest';

import { at, attack, city, own, scenario } from './scenario/dsl.ts';
import { playerView } from '../src/queries/player-view.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const LINE = `
  ~  ~  ~  ~  ~  ~  ~  ~
  A1 a  a  a  b  b  b  B1
  ~  ~  ~  ~  ~  ~  ~  ~
`;

describe('состояния артиллерии в UnitView', () => {
  it('передаёт обстрел, отсутствие цели и поддержку атакующего отряда', () => {
    const firing = scenario(LINE, { legend });
    firing.unit('A', 'artillery', 100, at(3, 1));
    const firingTarget = firing.unit('B', 'infantry', 100, at(5, 1));
    firing.runTicks(1);
    const firingView = playerView(firing.state, 0).units.find((u) => u.type === 'artillery');
    expect(firingView?.fireTarget).toBe(firingTarget);
    expect(firingView?.artillerySupport).toBe(false);

    const support = scenario(LINE, { legend });
    support.unit('A', 'artillery', 100, at(2, 1));
    const infantry = support.unit('A', 'infantry', 100, at(3, 1));
    support.unit('B', 'infantry', 100, at(4, 1));
    support.cmd('A', attack([infantry], at(4, 1)));
    support.runTicks(1);
    expect(
      playerView(support.state, 0).units.find((u) => u.id === infantry)?.artillerySupport,
    ).toBe(true);

    const belowThreshold = scenario(LINE, { legend });
    belowThreshold.unit('A', 'artillery', 99, at(2, 1));
    const belowInfantry = belowThreshold.unit('A', 'infantry', 100, at(3, 1));
    belowThreshold.unit('B', 'infantry', 100, at(4, 1));
    belowThreshold.cmd('A', attack([belowInfantry], at(4, 1)));
    belowThreshold.runTicks(1);
    expect(
      playerView(belowThreshold.state, 0).units.find((u) => u.id === belowInfantry)
        ?.artillerySupport,
    ).toBe(false);

    const outsideRange = scenario(LINE, { legend });
    outsideRange.unit('A', 'artillery', 100, at(1, 1));
    const outsideInfantry = outsideRange.unit('A', 'infantry', 100, at(3, 1));
    outsideRange.unit('B', 'infantry', 100, at(4, 1));
    outsideRange.cmd('A', attack([outsideInfantry], at(4, 1)));
    outsideRange.runTicks(1);
    expect(
      playerView(outsideRange.state, 0).units.find((u) => u.id === outsideInfantry)
        ?.artillerySupport,
    ).toBe(false);

    const noTarget = scenario(LINE, { legend });
    noTarget.unit('A', 'artillery', 100, at(2, 1));
    noTarget.runTicks(1);
    const noTargetView = playerView(noTarget.state, 0).units.find((u) => u.type === 'artillery');
    expect(noTargetView?.fireTarget).toBe(-1);
    expect(noTargetView?.artillerySupport).toBe(false);
  });
});
