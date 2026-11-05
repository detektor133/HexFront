import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  b  b  b  B1
  a  a  a  a  b  b  b  b
  a  a  a  a  b  b  b  b
  a  a  a  a  b  b  b  b
`;
const legend = {
  A1: city('A', 3, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('закупка под заказ численности', () => {
  it('когда готовых отрядов мало, ИИ закупает недостающих и новобранцы приходят в армию', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const player = s.state.players[0];
    if (player) player.gold = 100_000_000 as never;
    s.unit('A', 'infantry', 100, at(2, 1));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 500 } },
    ]);
    const army = s.state.armies.find((a) => a.owner === 0);
    expect(army?.wanted).toBe(500);

    s.runSeconds(40);
    const soldiers = s.state.units
      .filter((u) => u.armyId === army?.id)
      .reduce((sum, u) => sum + u.soldiers, 0);
    const queued = s.state.recruits
      .filter((r) => r.armyId === army?.id)
      .reduce((sum, r) => sum + r.soldiers, 0);
    expect(soldiers + queued).toBeGreaterThan(100_000);
    expect(s.state.units.filter((u) => u.armyId === army?.id).length).toBeGreaterThan(1);
  });

  it('с заданным составом ИИ закупает недостающую технику, а не одну пехоту', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const player = s.state.players[0];
    if (player) player.gold = 100_000_000 as never;
    s.unit('A', 'infantry', 300, at(2, 1));
    applyCommands(s.state, [
      {
        playerId: 0,
        cmd: { t: 'holdBorder', target: 1, soldiers: 400, mix: { armor: 100, artillery: 0 } },
      },
    ]);
    const army = s.state.armies.find((a) => a.owner === 0);
    s.runSeconds(40);
    const armor = [
      ...s.state.units.filter((u) => u.armyId === army?.id && u.type === 'armor'),
      ...s.state.recruits.filter((r) => r.armyId === army?.id && r.type === 'armor'),
    ];
    expect(armor.length).toBeGreaterThan(0);
  });

  it('армия без приказа и без отрядов набирает до лимита, который задан командой', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const player = s.state.players[0];
    if (player) player.gold = 100_000_000 as never;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: 'Запас' } }]);
    const army = s.state.armies.find((a) => a.owner === 0);
    expect(army?.dir).toBeUndefined();
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'setArmyLimit', armyId: army?.id ?? -1, soldiers: 300 } },
    ]);
    s.runSeconds(40);
    const soldiers = s.state.units
      .filter((u) => u.armyId === army?.id)
      .reduce((sum, u) => sum + u.soldiers, 0);
    const queued = s.state.recruits
      .filter((r) => r.armyId === army?.id)
      .reduce((sum, r) => sum + r.soldiers, 0);
    expect(soldiers + queued).toBeGreaterThanOrEqual(250_000);
  });

  it('лимит уменьшен — лишние солдаты уходят в резерв: целыми отрядами и отделённой частью', () => {
    const s = scenario(MAP, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    const ids = [1, 2, 3].map((row) => s.unit('A', 'infantry', 300, at(2, row)));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: 'Строй' } }]);
    const army = s.state.armies.find((a) => a.owner === 0 && a.name === 'Строй');
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'assignUnits', unitIds: ids, armyId: army?.id ?? -1 } },
      { playerId: 0, cmd: { t: 'setArmyLimit', armyId: army?.id ?? -1, soldiers: 400 } },
    ]);
    s.runSeconds(3);
    const inArmy = s.state.units
      .filter((u) => u.armyId === army?.id)
      .reduce((sum, u) => sum + u.soldiers, 0);
    const reserve = s.state.units
      .filter((u) => u.owner === 0 && u.armyId === null)
      .reduce((sum, u) => sum + u.soldiers, 0);
    expect(inArmy).toBe(400_000);
    expect(reserve).toBe(500_000);
  });
});
