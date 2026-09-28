import { describe, expect, it } from 'vitest';

import { playerView } from '../../src/queries/player-view.ts';
import {
  assignFront,
  assignUnits,
  at,
  city,
  createArmy,
  move,
  own,
  raw,
  renameArmy,
  scenario,
  setOffensiveLine,
  startOffensive,
  stopOffensive,
} from '../scenario/dsl.ts';

// Земля A — столбцы 0–2, B — 3–7.
const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

type S = ReturnType<typeof scenario>;

function armyWithUnit(s: S): { army: number; unit: number } {
  const unit = s.unit('A', 'infantry', 300, at(1, 2));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits([unit], army), 'auto');
  s.runTicks(1);
  return { army, unit };
}

const autoOf = (s: S, army: number): boolean | undefined =>
  s.state.armies.find((a) => a.id === army)?.auto;

describe('автокомандование: флаг и команды (04/T19, CR-006)', () => {
  it('по умолчанию настройка игрока включена, новая армия — с auto', () => {
    const s = scenario(FIELD, { legend });
    expect(s.player('A').autoCommand).toBe(true);
    const { army } = armyWithUnit(s);
    expect(autoOf(s, army)).toBe(true);
    const view = playerView(s.state, 0);
    expect(view.me.autoCommand).toBe(true);
    expect(view.armies.find((a) => a.id === army)?.auto).toBe(true);
  });

  it('новая армия получает auto по настройке «Автокомандование»', () => {
    const s = scenario(FIELD, { legend });
    s.cmd('A', raw({ t: 'setAutoCommand', on: false }));
    s.runTicks(1);
    expect(s.player('A').autoCommand).toBe(false);
    const { army } = armyWithUnit(s);
    expect(autoOf(s, army)).toBe(false);
  });

  it('ручная команда выключает auto, команда commander — нет; setArmyAuto возвращает', () => {
    const s = scenario(FIELD, { legend });
    const { army } = armyWithUnit(s);
    s.cmd('A', assignFront(army, 'B', null), 'auto');
    s.runTicks(1);
    expect(autoOf(s, army)).toBe(true);
    s.cmd('A', assignFront(army, 'B', null));
    s.runTicks(1);
    expect(autoOf(s, army)).toBe(false);
    s.cmd('A', raw({ t: 'setArmyAuto', armyId: army, on: true }));
    s.runTicks(1);
    expect(autoOf(s, army)).toBe(true);
  });

  it('ручной приказ отряду армии выключает её auto; передача отрядов — у обеих армий', () => {
    const s = scenario(FIELD, { legend });
    const first = armyWithUnit(s);
    s.cmd('A', move([{ unitOf: 'A', index: 0 }], at(0, 0)));
    s.runTicks(1);
    expect(autoOf(s, first.army)).toBe(false);
    const second = armyWithUnit(s);
    s.cmd('A', raw({ t: 'setArmyAuto', armyId: first.army, on: true }));
    s.cmd('A', assignUnits([first.unit], second.army));
    s.runTicks(1);
    expect(autoOf(s, first.army)).toBe(false);
    expect(autoOf(s, second.army)).toBe(false);
  });

  it('▶ «Начать», ■ «Стоп» и переименование auto не выключают', () => {
    const s = scenario(FIELD, { legend });
    const { army } = armyWithUnit(s);
    s.cmd('A', assignFront(army, 'B', null), 'auto');
    s.cmd('A', setOffensiveLine(army, [at(5, 0), at(5, 4)]), 'auto');
    s.runTicks(1);
    s.cmd('A', startOffensive(army));
    s.cmd('A', stopOffensive(army));
    s.cmd('A', renameArmy(army, 'Север'));
    s.runTicks(1);
    expect(autoOf(s, army)).toBe(true);
  });

  it('чужую армию переключить нельзя', () => {
    const s = scenario(FIELD, { legend });
    const { army } = armyWithUnit(s);
    s.cmd('B', raw({ t: 'setArmyAuto', armyId: army, on: false }));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notOwnArmy']);
    expect(autoOf(s, army)).toBe(true);
  });
});
