import { describe, expect, it } from 'vitest';

import { validateUnitCommand } from '../../src/commands/unit.ts';
import { at, city, createArmy, move, own, raw, scenario } from '../scenario/dsl.ts';

const LINE = `
  a  a  a  a  a  a  .  .
  A1 a  a  a  a  a  .  B1
  a  a  a  a  a  a  .  .
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
};
const make = () => scenario(LINE, { legend });

describe('остановка отрядов', () => {
  it('идущий отряд встаёт, прогресс перехода теряется, стоящему команда не вредит', () => {
    const s = make();
    const walker = s.unit('A', 'infantry', 100, at(1, 1));
    const idle = s.unit('A', 'infantry', 100, at(1, 0));
    s.cmd('A', move([{ unitOf: 'A', index: 0 }], at(5, 1)));
    s.runTicks(10);
    const unit = s.unitById(walker);
    expect(unit?.order).toBe('move');
    expect(unit?.moveTicks).toBeGreaterThan(0);
    const hex = unit?.hex;

    s.cmd('A', raw({ t: 'stop', unitIds: [walker, idle] }));
    s.runTicks(1);

    expect(s.rejections()).toEqual([]);
    expect(s.unitById(walker)).toMatchObject({ order: 'idle', path: [], moveTotal: 0, hex });
    expect(s.unitById(idle)?.order).toBe('idle');
  });

  it('отказывает для чужого, несуществующего, отступающего и воюющего, не меняя состояние', () => {
    const s = make();
    const own1 = s.unit('A', 'infantry', 100, at(1, 1));
    const enemy = s.unit('B', 'infantry', 100, at(7, 1));
    const retreating = s.unit('A', 'infantry', 100, at(2, 1));
    const fighting = s.unit('A', 'infantry', 100, at(3, 1));
    const a = s.unitById(retreating);
    const f = s.unitById(fighting);
    if (!a || !f) throw new Error('отряды не созданы');
    a.order = 'retreat';
    f.inBattle = true; // из боя остановиться можно (как в HoI4)
    const before = JSON.stringify(s.state.units);

    const reasons = [[enemy], [999], [retreating], [fighting], [own1, fighting]].map((unitIds) => {
      const result = validateUnitCommand(s.state, 0, { t: 'stop', unitIds });
      return result.ok ? 'ok' : result.reason;
    });

    expect(reasons).toEqual(['notOwnUnit', 'unknownUnit', 'retreating', 'ok', 'ok']);
    expect(JSON.stringify(s.state.units)).toBe(before);
  });

  it('стоп auto армии отряда не выключает', () => {
    const s = make();
    const id = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', createArmy('Первая'));
    s.runTicks(1);
    const army = s.armiesOf('A')[0];
    if (!army) throw new Error('армия не создана');
    const unit = s.unitById(id);
    if (!unit) throw new Error('отряд не найден');
    unit.armyId = army.id;
    army.auto = true;

    s.cmd('A', raw({ t: 'stop', unitIds: [id] }));
    s.runTicks(1);

    expect(army.auto).toBe(true);
  });
});
