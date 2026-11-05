import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { validate } from '../../src/commands/apply.ts';
import { borderPieces } from '../../src/commands/launch.ts';
import { createDiplomacy } from '../../src/state/relations.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  b  b  b  B1
  a  a  a  a  b  b  b  b
  a  a  a  a  b  b  b  b
  a  a  a  a  b  b  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

function game() {
  const s = scenario(MAP, { legend });
  s.state.diplomacy = createDiplomacy(s.state.players.length);
  for (const row of [0, 1, 2, 3]) s.unit('A', 'infantry', 300, at(2, row));
  return s;
}

describe('наступление одной командой', () => {
  it('в мире отклоняется: нужна война', () => {
    const s = game();
    expect(validate(s.state, 0, { t: 'launchOffensive', target: 1, soldiers: 600 })).toEqual({
      ok: false,
      reason: 'notEnemy',
    });
  });

  it('на войне армия набирает отряды под заказ, ставит фронт и запускает наступление', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    const cmd = { t: 'launchOffensive', target: 1, soldiers: 600 } as const;
    expect(validate(s.state, 0, cmd).ok).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd }]);

    const army = s.state.armies.find((a) => a.owner === 0);
    expect(army).toBeDefined();
    const units = s.state.units.filter((u) => u.armyId === army?.id);
    expect(units.reduce((sum, u) => sum + u.soldiers, 0)).toBeGreaterThanOrEqual(600_000);
    expect(units.length).toBeLessThan(4);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    expect(plan?.kind === 'front' && plan.offensive?.active).toBe(true);
    expect(army?.auto).toBe(false);
  });

  it('опустевшая безымянная армия, откуда забрали отряды, исчезает', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: '' } }]);
    const home = s.state.armies.find((a) => a.owner === 0);
    if (!home) throw new Error('нет стартовой армии');
    for (const u of s.state.units) if (u.owner === 0) u.armyId = home.id;
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 1200 } }]);
    expect(s.state.armies.some((a) => a.id === home.id)).toBe(false);
    expect(s.state.armies.some((a) => a.owner === 0 && a.dir !== undefined)).toBe(true);
  });

  it('делит армию надвое по числу солдат, вторая половина — новая армия без направления', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: 'Главная' } }]);
    const army = s.state.armies.find((a) => a.owner === 0 && a.name === 'Главная');
    if (!army) throw new Error('нет армии');
    for (const u of s.state.units) if (u.owner === 0) u.armyId = army.id;
    expect(validate(s.state, 0, { t: 'splitArmy', armyId: army.id })).toEqual({ ok: true });
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'splitArmy', armyId: army.id } }]);
    const armies = s.state.armies.filter((a) => a.owner === 0);
    expect(armies).toHaveLength(2);
    const sums = armies.map((a) =>
      s.state.units.filter((u) => u.armyId === a.id).reduce((sum, u) => sum + u.soldiers, 0),
    );
    expect(sums[0]).toBe(sums[1]);
    expect(armies.every((a) => a.dir === undefined)).toBe(true);
  });

  it('армия с одним отрядом не делится', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: 'Одна' } }]);
    const army = s.state.armies.find((a) => a.owner === 0 && a.name === 'Одна');
    const unit = s.state.units.find((u) => u.owner === 0);
    if (!army || !unit) throw new Error('нет армии или отряда');
    unit.armyId = army.id;
    expect(validate(s.state, 0, { t: 'splitArmy', armyId: army.id })).toEqual({
      ok: false,
      reason: 'tooFewUnits',
    });
  });

  it('солдат берут только из выбранных армий, лимит донора уменьшается', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'createArmy', name: 'Донор' } }]);
    const donor = s.state.armies.find((a) => a.owner === 0 && a.name === 'Донор');
    if (!donor) throw new Error('нет донора');
    donor.wanted = 600;
    const [first, second] = s.state.units.filter((u) => u.owner === 0);
    if (!first || !second) throw new Error('нет отрядов');
    first.armyId = donor.id;
    const cmd = { t: 'holdBorder', target: 1, soldiers: 300, from: [donor.id] } as const;
    expect(validate(s.state, 0, cmd).ok).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd }]);
    const dir = s.state.armies.find((a) => a.dir?.target === 1);
    expect(s.state.units.find((u) => u.id === first.id)?.armyId).toBe(dir?.id);
    // Вторая — резерв, не выбранный источник: осталась на месте.
    expect(s.state.units.find((u) => u.id === second.id)?.armyId).not.toBe(dir?.id);
    expect(s.state.armies.find((a) => a.id === donor.id)?.wanted).toBe(300);
    expect(validate(s.state, 0, { ...cmd, from: [999] })).toEqual({
      ok: false,
      reason: 'unknownArmy',
    });
  });

  it('держать границу можно и в мире: фронт и заказ без наступления', () => {
    const s = game();
    const cmd = { t: 'holdBorder', target: 1, soldiers: 600 } as const;
    expect(validate(s.state, 0, cmd).ok).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd }]);

    const army = s.state.armies.find((a) => a.owner === 0);
    expect(army?.wanted).toBe(600);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    expect(plan?.kind).toBe('front');
    expect(plan?.kind === 'front' && plan.offensive).toBeNull();
  });

  it('ничья земля тоже направление: фронт на границе у гекса клика и наступление без войны', () => {
    const open = `
      A1 a  a  .  .  .
      a  a  a  .  .  .
      a  a  a  .  .  B1
    `;
    const s = scenario(open, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [0, 1, 2]) s.unit('A', 'infantry', 300, at(2, row));
    const hex = at(4, 1).col + at(4, 1).row * s.state.map.width;
    const cmd = { t: 'launchOffensive', target: -1, soldiers: 300, hex } as const;
    expect(validate(s.state, 0, cmd).ok).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd }]);

    const army = s.state.armies.find((a) => a.owner === 0);
    // Ничья земля — отряды без плана: они идут занимать гексы у клика.
    expect(army?.dir).toMatchObject({ target: -1, mode: 'attack' });
    expect(s.state.plans.some((p) => p.armyId === army?.id)).toBe(false);
    s.runSeconds(20);
    expect(s.state.hexes.owner.filter((o) => o === 0).length).toBeGreaterThan(8);
  });

  it('удар по игроку: фронт — вся граница с ним, линию наступления строит ИИ, клик не нужен', () => {
    const wide = `
      A1 a  a  a  b  b  b  b  b  b  b
      a  a  a  a  b  b  b  b  b  b  b
      a  a  a  a  b  b  b  b  b  b  b
      a  a  a  a  b  b  b  b  b  b  b
      a  a  a  a  b  b  b  b  b  b  B1
      a  a  a  a  b  b  b  b  b  b  b
      a  a  a  a  b  b  b  b  b  b  b
      a  a  a  a  b  b  b  b  b  b  b
    `;
    const s = scenario(wide, { legend });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [0, 2, 4, 6]) s.unit('A', 'infantry', 300, at(3, row));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    const width = s.state.map.width;
    const click = at(6, 7).col + at(6, 7).row * width;
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 300, hex: click } },
    ]);

    const army = s.state.armies.find((a) => a.owner === 0);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    if (plan?.kind !== 'front' || !plan.offensive) throw new Error('нет наступления');
    const border = borderPieces(s.state, 0, 1).flat();
    // Фронт закрывает всю границу с игроком, а линия — лишь участок удара, выбранный ИИ.
    expect(plan.edges.length).toBe(border.length);
    expect(plan.offensive.hexes.length).toBeGreaterThan(0);
    expect(plan.offensive.hexes.length).toBeLessThan(border.length);
  });

  it('фронт стоит только на границе с целью, а не на границе с другим соседом', () => {
    const three = `
      A1 a  a  b  b  B1
      a  a  a  b  b  b
      a  a  a  c  c  C1
      a  a  a  c  c  c
    `;
    const s = scenario(three, {
      legend: { ...legend, c: own('C'), C1: city('C', 1, { capital: true }) },
    });
    s.state.diplomacy = createDiplomacy(s.state.players.length);
    for (const row of [0, 1, 2, 3]) s.unit('A', 'infantry', 300, at(2, row));
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'declareWar', target: 1 } }]);
    // Клик по земле другого соседа ничего не меняет: ось и фронт определяет ИИ.
    const click = at(4, 3).col + at(4, 3).row * s.state.map.width;
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: 1, soldiers: 300, hex: click } },
    ]);
    s.runSeconds(5);
    const army = s.state.armies.find((a) => a.owner === 0);
    const plan = s.state.plans.find((p) => p.armyId === army?.id);
    if (plan?.kind !== 'front') throw new Error('нет фронта');
    expect(plan.edges.length).toBeGreaterThan(0);
    const owners = new Set(
      plan.edges.map((e) => {
        const hex = Math.floor(e / 6);
        return s.state.hexes.owner[hex];
      }),
    );
    expect([...owners]).toEqual([0]);
    const facing = plan.edges.every((e) => {
      const border = borderPieces(s.state, 0, 1).flat();
      return border.includes(e);
    });
    expect(facing).toBe(true);
  });

  it('занять ничью землю: армия доходит до линии и берёт гексы, а не застывает на фронте', () => {
    const wide = `
      .  .  .  .  .  .  .  .  .  .  .  .  .
      .  .  .  .  .  .  .  .  .  .  .  .  .
      .  .  a  a  a  a  a  a  a  .  .  .  .
      .  .  a  a  a  a  a  a  a  .  .  .  .
      .  .  a  a  a  A1 a  a  a  .  .  .  .
      .  .  a  a  a  a  a  a  a  .  .  .  .
      .  .  a  a  a  a  a  a  a  .  .  .  .
      .  .  .  .  .  .  .  .  .  .  .  .  .
      .  .  .  .  .  .  .  .  .  .  .  .  B1
    `;
    const s = scenario(wide, { legend });
    for (const row of [2, 3, 4, 5, 6]) s.unit('A', 'infantry', 300, at(5, row));
    const mine = (): number => s.state.hexes.owner.filter((o) => o === 0).length;
    const before = mine();
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'launchOffensive', target: -1, soldiers: 1500 } },
    ]);
    s.runSeconds(120);
    expect(mine()).toBeGreaterThan(before + 6);
  });

  it('новый кусок границы с целью получает фронт сам: направление «держать» поддерживает его', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 600 } }]);
    const army = s.state.armies.find((a) => a.owner === 0);
    const count = (): number => {
      const plan = s.state.plans.find((p) => p.armyId === army?.id);
      return plan?.kind === 'front' ? plan.edges.length : 0;
    };
    const before = count();
    // Враг оказался внутри нашей земли: появился отдельный кусок границы.
    s.setOwner(at(0, 3), 'B');
    s.runSeconds(3);
    expect(count()).toBeGreaterThan(before);
  });

  it('0 солдат снимает направление: фронт убран, отряды в резерве, армия расформирована', () => {
    const s = game();
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 600 } }]);
    expect(s.state.armies.some((a) => a.owner === 0)).toBe(true);
    applyCommands(s.state, [{ playerId: 0, cmd: { t: 'holdBorder', target: 1, soldiers: 0 } }]);

    expect(s.state.armies.some((a) => a.owner === 0)).toBe(false);
    expect(s.state.plans).toHaveLength(0);
    expect(s.state.units.filter((u) => u.owner === 0).every((u) => u.armyId === null)).toBe(true);
  });
});
