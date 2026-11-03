import { describe, expect, it } from 'vitest';

import { at, city, createArmy, own, raw, scenario } from '../scenario/dsl.ts';

const legend = { A1: city('A', 1, { capital: true }), a: own('A') };
const MAP = `
  A1 a  a  a
  a  a  a  a
`;

describe('автопополнение раскидывает весь резерв', () => {
  it('включённое — резерв уходит в самую нуждающуюся армию, выключенное — копится', () => {
    for (const on of [true, false]) {
      const s = scenario(MAP, { legend });
      const big = s.unit('A', 'infantry', 900, at(1, 0));
      const weak = s.unit('A', 'infantry', 100, at(2, 0));
      const reserve = s.unit('A', 'infantry', 200, at(3, 0));
      s.cmd('A', createArmy('Сильная'));
      s.cmd('A', createArmy('Слабая'));
      s.runTicks(1);
      const [first, second] = s.state.armies.filter((a) => a.owner === 0);
      if (!first || !second) throw new Error('нет армий');
      const bigUnit = s.unitById(big);
      const weakUnit = s.unitById(weak);
      if (!bigUnit || !weakUnit) throw new Error('нет отрядов');
      bigUnit.armyId = first.id;
      weakUnit.armyId = second.id;
      s.cmd('A', raw({ t: 'setAutoReinforce', on }));
      s.runTicks(25);
      expect(s.unitById(reserve)?.armyId).toBe(on ? second.id : null);
    }
  });
});
