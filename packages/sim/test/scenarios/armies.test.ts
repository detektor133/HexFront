import { describe, expect, it } from 'vitest';

import small from '../../../mapgen/maps/small.json' with { type: 'json' };
import { loadMap } from '../../src/map/load.ts';
import type { Fp } from '../../src/math/int.ts';
import { createMatch } from '../../src/state/create-match.ts';
import {
  armyOrder,
  assignUnits,
  at,
  city,
  createArmy,
  disbandArmy,
  merge,
  own,
  raw,
  renameArmy,
  scenario,
  split,
} from '../scenario/dsl.ts';

const MAP = `
  a  a  a  a  .
  A1 a  a  a  .
  a  a  a  a  B1
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
};

describe('армии — группы отрядов', () => {
  it('на старте оба отряда игрока — в «1-й армии»', () => {
    const result = loadMap(small);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const s = createMatch(result.map, [{ name: 'A' }, { name: 'B' }], 42);
    for (const p of s.players) {
      const armies = s.armies.filter((a) => a.owner === p.id);
      expect(armies).toHaveLength(1);
      expect(armies[0]?.number).toBe(1);
      expect(armies[0]?.name).toBe('');
      const units = s.units.filter((u) => u.owner === p.id);
      expect(units.map((u) => u.armyId)).toEqual([armies[0]?.id, armies[0]?.id]);
    }
  });

  it('createArmy: номера растут, имя можно задать; renameArmy меняет имя', () => {
    const s = scenario(MAP, { legend });
    s.cmd('A', createArmy(''));
    s.cmd('A', createArmy('Северная'));
    s.runTicks(1);
    const [first, second] = s.armiesOf('A');
    expect([first?.number, second?.number]).toEqual([1, 2]);
    expect(second?.name).toBe('Северная');
    s.cmd('A', renameArmy(first?.id ?? -1, 'Южная'));
    s.runTicks(1);
    expect(s.armiesOf('A')[0]?.name).toBe('Южная');
  });

  it('слишком длинное имя или чужая армия — отказ', () => {
    const s = scenario(MAP, { legend });
    s.cmd('B', createArmy(''));
    s.cmd('A', createArmy('x'.repeat(33)));
    s.runTicks(1);
    const b = s.armiesOf('B')[0]?.id ?? -1;
    s.cmd('A', renameArmy(b, 'Моя'));
    s.cmd('A', disbandArmy(b));
    s.cmd('A', renameArmy(999, 'Нет'));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['badName', 'notOwnArmy', 'notOwnArmy', 'unknownArmy']);
  });

  it('assignUnits: отряды в армию и обратно в резерв; чужие отряды нельзя', () => {
    const s = scenario(MAP, { legend });
    const u1 = s.unit('A', 'infantry', 100, at(1, 1));
    const u2 = s.unit('A', 'artillery', 100, at(2, 1));
    const enemy = s.unit('B', 'infantry', 100, at(4, 1));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A')[0]?.id ?? -1;
    s.cmd('A', assignUnits([u1, u2], army));
    s.cmd('A', assignUnits([enemy], army));
    s.runTicks(1);
    expect([s.unitById(u1)?.armyId, s.unitById(u2)?.armyId]).toEqual([army, army]);
    expect(s.unitById(enemy)?.armyId).toBeNull();
    s.cmd('A', assignUnits([u2], null));
    s.runTicks(1);
    expect(s.unitById(u2)?.armyId).toBeNull();
    expect(s.rejections()).toEqual(['notOwnUnit']);
  });

  it('disbandArmy: армия удаляется, её отряды уходят в резерв', () => {
    const s = scenario(MAP, { legend });
    const u = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A')[0]?.id ?? -1;
    s.cmd('A', assignUnits([u], army));
    s.runTicks(1);
    s.cmd('A', disbandArmy(army));
    s.runTicks(1);
    expect(s.armiesOf('A')).toEqual([]);
    expect(s.unitById(u)?.armyId).toBeNull();
  });

  it('приказ армии получают все её отряды, резерв — нет; артиллерия на экспансии — idle', () => {
    const s = scenario(MAP, { legend });
    const inf = s.unit('A', 'infantry', 100, at(1, 1));
    const art = s.unit('A', 'artillery', 100, at(1, 0));
    const reserve = s.unit('A', 'infantry', 100, at(2, 2));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A')[0]?.id ?? -1;
    s.cmd('A', assignUnits([inf, art], army));
    s.cmd('A', armyOrder(army, 'hold'));
    s.runTicks(1);
    expect([inf, art, reserve].map((id) => s.unitById(id)?.order)).toEqual([
      'hold',
      'hold',
      'idle',
    ]);
    s.cmd('A', armyOrder(army, 'expand'));
    s.runTicks(1);
    expect(s.unitById(inf)?.order).toBe('expand');
    expect(s.unitById(art)?.order).toBe('idle');
  });

  it('вытянули часть из фишки в соседний гекс — отделённый отряд сразу идёт туда', () => {
    const s = scenario(MAP, { legend });
    const a = s.unit('A', 'infantry', 300, at(1, 1));
    const to = at(1, 0).col + at(1, 0).row * s.state.map.width;
    s.cmd('A', raw({ t: 'split', unitId: a, soldiers: 100_000 as Fp, to }));
    s.runTicks(1);
    const fresh = s.unitsOf('A').at(-1);
    expect(s.unitById(a)?.soldiers).toBe(200_000);
    expect(fresh?.soldiers).toBe(100_000);
    expect(fresh?.order).toBe('move');
    expect(fresh?.path.at(-1)).toBe(to);
  });

  it('разделение оставляет новый отряд в армии, слияние — в армии отряда с меньшим id', () => {
    const s = scenario(MAP, { legend });
    const a = s.unit('A', 'infantry', 300, at(1, 1));
    const b = s.unit('A', 'infantry', 100, at(1, 1));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A')[0]?.id ?? -1;
    s.cmd('A', assignUnits([a], army));
    s.cmd('A', split(a, 100));
    s.runTicks(1);
    const fresh = s.unitsOf('A').at(-1);
    expect(fresh?.armyId).toBe(army);
    s.cmd('A', merge([b, fresh?.id ?? -1]));
    s.runTicks(1);
    // b (id меньше) в резерве — слитый отряд остаётся в резерве.
    expect(s.unitById(b)?.armyId).toBeNull();
    expect(s.unitById(b)?.soldiers).toBe(200_000);
  });
});
