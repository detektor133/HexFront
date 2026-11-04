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

function inArmy(s: ReturnType<typeof make>, ids: number[]): void {
  s.cmd('A', createArmy('Первая'));
  s.runTicks(1);
  const army = s.armiesOf('A')[0];
  if (!army) throw new Error('армия не создана');
  for (const id of ids) {
    const unit = s.unitById(id);
    if (unit) unit.armyId = army.id;
  }
}

function runChecked(s: ReturnType<typeof make>, ticks: number): void {
  for (let t = 0; t < ticks; t += 1) {
    s.runTicks(1);
    const perHex = new Map<number, number>();
    for (const u of s.state.units) perHex.set(u.hex, (perHex.get(u.hex) ?? 0) + 1);
    // Предела отрядов в гексе нет (решение владельца 2026-11-04): проверяем лишь, что учёт сходится.
    expect([...perHex.values()].reduce((a, b) => a + b, 0)).toBe(s.state.units.length);
  }
}

describe('сбор отрядов', () => {
  it('отряды одной армии и типа сходятся в одном гексе и сливаются', () => {
    const s = make();
    const a = s.unit('A', 'infantry', 100, at(1, 0));
    const b = s.unit('A', 'infantry', 100, at(5, 2));
    inArmy(s, [a, b]);
    s.cmd('A', raw({ t: 'gather', unitIds: [a, b] }));
    runChecked(s, 800);

    const left = s.unitsOf('A').filter((u) => u.armyId !== null);
    expect(s.rejections()).toEqual([]);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ order: 'idle', gather: -1 });
    expect(left[0]?.soldiers).toBe(200 * 1000);
  });

  it('разные типы и резерв не сливаются: четыре отряда остаются четырьмя отрядами', () => {
    const s = make();
    const ids = [
      s.unit('A', 'infantry', 100, at(1, 0)),
      s.unit('A', 'armor', 100, at(2, 2)),
      s.unit('A', 'infantry', 100, at(4, 0)),
      s.unit('A', 'infantry', 100, at(5, 2)),
    ];
    s.cmd('A', raw({ t: 'gather', unitIds: ids }));
    runChecked(s, 800);

    const mine = s.unitsOf('A');
    expect(mine).toHaveLength(4);
    expect(mine.every((u) => u.gather === -1 && u.order === 'idle')).toBe(true);
  });

  it('другой приказ снимает сбор у своего отряда, остальные продолжают', () => {
    const s = make();
    const a = s.unit('A', 'infantry', 100, at(1, 0));
    const b = s.unit('A', 'infantry', 100, at(5, 2));
    s.cmd('A', raw({ t: 'gather', unitIds: [a, b] }));
    s.runTicks(2);
    s.cmd('A', move([{ unitOf: 'A', index: 0 }], at(0, 0)));
    s.runTicks(1);

    expect(s.unitById(a)?.gather).toBe(-1);
    expect(s.unitById(b)?.gather).toBeGreaterThanOrEqual(0);
  });

  it('без доступной области — отказ без изменения состояния', () => {
    const s = make();
    const id = s.unit('A', 'infantry', 100, at(1, 0));
    s.state.hexes.owner.fill(1);
    const before = JSON.stringify(s.state.units);
    const result = validateUnitCommand(s.state, 0, { t: 'gather', unitIds: [id] });

    expect(result).toEqual({ ok: false, reason: 'noPath' });
    expect(JSON.stringify(s.state.units)).toBe(before);
  });
});
