import { describe, expect, it } from 'vitest';

import { intDiv } from '../../src/math/int.ts';
import { assignFront, assignUnits, at, city, createArmy, own, scenario } from '../scenario/dsl.ts';

// Страна A с двумя городами; граница с B длиннее, чем отрядов: приоритет определяет, что закрыто.
const MAP = `
  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b
  b  b  a  a  a  a  b  b
  b  b  a  A1 a  a  b  b
  b  b  a  a  a  A2 b  b
  b  b  a  a  a  a  b  b
  b  b  b  b  b  b  b  B1
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  A2: city('A', 1),
  B1: city('B', 1, { capital: true }),
  a: own('A'),
  b: own('B'),
};

describe('приоритет закрытия фронта', () => {
  it('город на границе закрыт отрядом, даже когда границы больше, чем отрядов', () => {
    const s = scenario(MAP, { legend });
    const capital = s.state.cities.find((c) => c.owner === 0)?.hex ?? 0;
    const w = s.state.map.width;
    const home = at(capital % w, intDiv(capital, w));
    const ids = [1, 2, 3].map(() => s.unit('A', 'infantry', 300, home));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits(ids, army));
    s.cmd('A', assignFront(army, 'B', null));
    s.runSeconds(40);

    const border = s.cityAt(at(5, 4));
    if (!border) throw new Error('нет города на границе');
    expect(s.unitsOf('A').some((u) => u.hex === border.hex)).toBe(true);
  });
});
