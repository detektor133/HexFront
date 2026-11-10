import { describe, expect, it } from 'vitest';

import { FRONT_ALLOC_TICKS, type UnitType } from '../../src/balance.ts';
import { assignFront, assignUnits, at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

// Большая армия не должна стоять без дела из-за лимитов на выдачу маршрутов: A — столбцы 0–4,
// B — 5–9, фронт — вся граница. Ряды 0–13.
const COLS = 14;
const ROWS = 18;
const mapText = (): string => {
  const rows: string[] = [];
  for (let r = 0; r < ROWS; r += 1) {
    const cells: string[] = [];
    for (let c = 0; c < COLS; c += 1) {
      if (r === 0 && c === 0) cells.push('A1');
      else if (r === 0 && c === COLS - 1) cells.push('B1');
      else cells.push(c < COLS / 2 ? 'a' : 'b');
    }
    rows.push(cells.join(' '));
  }
  return rows.join('\n');
};
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 5, { capital: true }),
  b: own('B'),
};

type S = ReturnType<typeof scenario>;

/** Армия A: n пехоты и m артиллерии в тылу (столбец 0, по одному на гекс: стопки сливаются сами). */
function bigArmy(s: S, infantry: number, artillery: number): number {
  const place = (type: UnitType, index: number) =>
    s.unit('A', type, 300, at(Math.floor(index / (ROWS - 1)), 1 + (index % (ROWS - 1))));
  const ids = [
    ...Array.from({ length: infantry }, (_, i) => place('infantry', i)),
    ...Array.from({ length: artillery }, (_, i) => place('artillery', infantry + i)),
  ];
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const id = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(ids, id), 'auto');
  s.runTicks(1);
  return id;
}

// «Без дела»: место назначено, отряд не там и никуда не идёт — ждёт, пока ему построят маршрут.
const waiting = (s: S, id: number, type?: UnitType) =>
  s.state.units.filter(
    (u) =>
      u.armyId === id &&
      (type === undefined || u.type === type) &&
      u.slot >= 0 &&
      u.hex !== u.slot &&
      u.order === 'idle',
  );

describe('пропускная способность расстановки армии', () => {
  it('90 отрядов и 12 орудий: через 3 секунды после расстановки без маршрута никого нет', () => {
    const s = scenario(mapText(), { legend });
    const id = bigArmy(s, 90, 12);
    s.cmd('A', assignFront(id, 'B', null), 'auto');
    s.runTicks(FRONT_ALLOC_TICKS + 30);
    expect(s.state.units.filter((u) => u.armyId === id).length).toBeGreaterThanOrEqual(40);
    expect(waiting(s, id)).toHaveLength(0);
  });

  it('и дальше армия не простаивает: после трёх расстановок ждущих нет, орудия на местах', () => {
    const s = scenario(mapText(), { legend });
    const id = bigArmy(s, 90, 12);
    s.cmd('A', assignFront(id, 'B', null), 'auto');
    s.runTicks(FRONT_ALLOC_TICKS * 3);
    expect(waiting(s, id)).toHaveLength(0);
    expect(waiting(s, id, 'artillery')).toHaveLength(0);
  });
});
