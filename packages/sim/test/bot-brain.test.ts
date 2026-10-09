import { describe, expect, it } from 'vitest';

import { BOT_EASY_TAX } from '../src/balance.ts';
import { assignFront, assignUnits, at, city, createArmy, own, scenario } from './scenario/dsl.ts';
import { brainDecide } from '../src/bots/brain.ts';
import { createBotTickContext } from '../src/bots/context.ts';
import { FP, type Fp } from '../src/math/int.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
`;

describe('мозг бота', () => {
  it('делает несколько трат, но не превышает BOT_MAX_SPENDS', () => {
    const match = scenario(
      `
        A1 a A2 a B1 b b
        a  a  a  a  b  b  b
      `,
      { legend, fog: false },
    );
    match.player('A').gold = (5000 * FP) as Fp;
    const context = createBotTickContext(match.state);
    const commands = brainDecide(match.state, 0, context, 'medium');
    const spends = commands.filter((command) =>
      ['foundCity', 'upgradeCity', 'improve', 'rebuildSupply', 'recruit'].includes(command.t),
    );

    expect(spends.length).toBeGreaterThan(1);
    expect(spends.length).toBeLessThanOrEqual(3);
  });

  it('запускает и останавливает наступление по отношению сил', () => {
    const match = scenario(FIELD, { legend, fog: false });
    const unitIds = [0, 1, 2].map(() => match.unit('A', 'infantry', 300, at(2, 2)));
    match.cmd('A', createArmy(''));
    match.runTicks(1);
    const armyId = match.armiesOf('A')[0]?.id ?? -1;
    match.cmd('A', assignUnits(unitIds, armyId), 'auto');
    match.cmd('A', assignFront(armyId, 'B', null), 'auto');
    match.runSeconds(20);
    match.unit('B', 'infantry', 20, at(3, 2));
    const context = createBotTickContext(match.state);
    expect(brainDecide(match.state, 0, context, 'medium')).toContainEqual({
      t: 'startOffensive',
      armyId,
    });
    const plan = match.state.plans.find((value) => value.armyId === armyId);
    if (!plan || plan.kind !== 'front') throw new Error('фронт армии не создан');
    match.state.plans[match.state.plans.indexOf(plan)] = {
      ...plan,
      offensive: { edges: plan.edges, hexes: [], active: true, progressTick: 0, taken: [] },
    };
    match.unit('B', 'infantry', 9000, at(3, 2));
    expect(brainDecide(match.state, 0, createBotTickContext(match.state), 'medium')).toContainEqual(
      {
        t: 'stopOffensive',
        armyId,
      },
    );
  });

  it('easy сохраняет налог 20 % и не выдаёт ▶', () => {
    const match = scenario('A1 a B1 b', { legend, fog: false });
    const commands = brainDecide(match.state, 0, createBotTickContext(match.state), 'easy');

    expect(commands).toContainEqual({ t: 'setTax', rate: BOT_EASY_TAX });
    expect(commands.some((command) => command.t === 'startOffensive')).toBe(false);
  });

  it('не выдаёт ▶ или ■ для чужой армии', () => {
    const match = scenario(FIELD, { legend, fog: false });
    const unitIds = [0, 1, 2].map(() => match.unit('B', 'infantry', 300, at(5, 2)));
    match.cmd('B', createArmy(''));
    match.runTicks(1);
    const armyId = match.armiesOf('B')[0]?.id ?? -1;
    match.cmd('B', assignUnits(unitIds, armyId), 'auto');
    match.cmd('B', assignFront(armyId, 'A', null), 'auto');
    match.runSeconds(20);
    const plan = match.state.plans.find((value) => value.armyId === armyId);
    if (!plan || plan.kind !== 'front') throw new Error('фронт армии не создан');
    match.state.plans[match.state.plans.indexOf(plan)] = {
      ...plan,
      offensive: { edges: plan.edges, hexes: [], active: true, progressTick: 0, taken: [] },
    };

    const commands = brainDecide(match.state, 0, createBotTickContext(match.state), 'medium');

    expect(commands).not.toContainEqual({ t: 'stopOffensive', armyId });
    expect(commands).not.toContainEqual({ t: 'startOffensive', armyId });
  });

  it('easy не выдаёт ■ для активного наступления', () => {
    const match = scenario(FIELD, { legend, fog: false });
    const unitIds = [0, 1, 2].map(() => match.unit('A', 'infantry', 300, at(2, 2)));
    match.cmd('A', createArmy(''));
    match.runTicks(1);
    const armyId = match.armiesOf('A')[0]?.id ?? -1;
    match.cmd('A', assignUnits(unitIds, armyId), 'auto');
    match.cmd('A', assignFront(armyId, 'B', null), 'auto');
    match.runSeconds(20);
    const plan = match.state.plans.find((value) => value.armyId === armyId);
    if (!plan || plan.kind !== 'front') throw new Error('фронт армии не создан');
    match.state.plans[match.state.plans.indexOf(plan)] = {
      ...plan,
      offensive: { edges: plan.edges, hexes: [], active: true, progressTick: 0, taken: [] },
    };

    const commands = brainDecide(match.state, 0, createBotTickContext(match.state), 'easy');

    expect(commands.some((command) => command.t === 'startOffensive')).toBe(false);
    expect(commands.some((command) => command.t === 'stopOffensive')).toBe(false);
  });
});
