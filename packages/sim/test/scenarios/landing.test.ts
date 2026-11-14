import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { withDepot } from '../../src/state/building.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { assignUnits, at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

// Западный остров игрока A с портом; восток — земля B, берег для высадки на краю её земли.
const MAP = `
  A1 a  ~  ~  ~  b  b  b  B1
  a  a  ~  ~  ~  b  b  b  b
  a  a  ~  ~  ~  b  b  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('высадка десанта', () => {
  it('после высадки армия сама встаёт на плацдарм: фронт у границы с хозяином берега и наступление', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const w = s.state.map.width;
    const port = 1 + w;
    s.state.hexes.building[port] = withDepot(s.state.hexes.building[port] ?? 0, 1);
    const ids = [s.unit('A', 'infantry', 400, at(1, 1)), s.unit('A', 'infantry', 400, at(1, 2))];
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits(ids, army));
    s.runTicks(1);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    const shore = 5 + w;
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'invade', armyId: army, from: port, to: shore } },
    ]);
    const landed = s.state.armies.find((a) => a.id === army);
    expect(landed?.invading).toBe(true);
    expect(landed?.landing?.target).toBe(1);
    // Ждём конца плавания: в тот же тик армия получает направление на плацдарм.
    for (let i = 0; i < 600 && s.state.armies.find((x) => x.id === army)?.invading; i += 1) {
      s.runTicks(1);
    }
    const after = s.state.armies.find((x) => x.id === army);
    expect(after?.invading).toBeUndefined();
    expect(after?.dir?.target).toBe(1);
    expect(after?.dir?.mode).toBe('attack');
    expect(after?.dir?.pocket).toBe(shore);
    // Как только берег взят, ставится фронт на границе плацдарма.
    for (let i = 0; i < 300 && !s.state.plans.some((p) => p.armyId === army); i += 1) {
      s.runTicks(1);
    }
    const plan = s.state.plans.find((p) => p.armyId === army);
    expect(s.state.hexes.owner[shore]).toBe(0);
    expect(plan?.kind).toBe('front');
    expect(plan?.kind === 'front' && plan.edges.length).toBeGreaterThan(0);
    // Через пару секунд ИИ строит и запускает линию наступления от плацдарма.
    s.runSeconds(3);
    const next = s.state.plans.find((p) => p.armyId === army);
    expect(next?.kind === 'front' && next.offensive?.active).toBe(true);
  });
});
