import { describe, expect, it } from 'vitest';

import { FRONT_ALLOC_TICKS } from '../../src/balance.ts';
import { edgeOther } from '../../src/state/edges.ts';
import { frontSystem } from '../../src/systems/front.ts';
import {
  assignFront,
  assignUnits,
  at,
  city,
  createArmy,
  drawFront,
  own,
  raw,
  scenario,
  startOffensive,
} from '../scenario/dsl.ts';

// Строка 0 — ничья земля; A — столбцы 0–2, B — 3–7.
const MAP = `
  .  .  .  .  .  .  .  .
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

// Армия A с n отрядами; передача отрядов — как от commander (auto не выключает).
function army(s: S, n: number): number {
  const ids = Array.from({ length: n }, () => s.unit('A', 'infantry', 300, at(1, 2)));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const id = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(ids, id), 'auto');
  s.runTicks(1);
  return id;
}

const edgesOf = (s: S, id: number): readonly number[] => {
  const plan = s.state.plans.find((p) => p.armyId === id);
  return plan?.kind === 'front' ? plan.edges : [];
};

// Грани фронта, за которыми не враг (ничья земля).
const neutralEdges = (s: S, id: number): number[] =>
  edgesOf(s, id).filter((e) => (s.state.hexes.owner[edgeOther(s.state, e)] ?? -1) < 0);

describe('фронт армии с «А» — только граница с врагом (04/T22a)', () => {
  it('гекс врага у фронта стал ничьим — его грани выпадают из фронта; у ручного фронта — нет', () => {
    const s = scenario(MAP, { legend });
    const auto = army(s, 1);
    const manual = army(s, 1);
    s.cmd('A', assignFront(auto, 'B', null), 'auto');
    s.cmd('A', assignFront(manual, 'B', null));
    s.runTicks(1);
    expect(s.state.armies.find((a) => a.id === manual)?.auto).toBe(false);
    s.setOwner(at(3, 2), null);
    expect(neutralEdges(s, auto)).toEqual([]);
    expect(edgesOf(s, auto).length).toBeGreaterThan(0);
    expect(neutralEdges(s, manual).length).toBeGreaterThan(0);
  });

  it('включили «А» у ручного фронта с гранями на ничью землю — они выпадают', () => {
    const s = scenario(MAP, { legend });
    const id = army(s, 1);
    s.cmd('A', drawFront(id, [at(0, 1), at(2, 1), at(2, 3)]));
    s.runTicks(1);
    expect(neutralEdges(s, id).length).toBeGreaterThan(0);
    s.cmd('A', raw({ t: 'setArmyAuto', armyId: id, on: true }));
    s.runTicks(1);
    expect(neutralEdges(s, id)).toEqual([]);
    expect(edgesOf(s, id).length).toBeGreaterThan(0);
  });

  it('наступление по ▶ до конца: ни в один тик во фронте нет граней с ничьей землёй', () => {
    const s = scenario(MAP, { legend });
    const id = army(s, 4);
    s.cmd('A', assignFront(id, 'B', null), 'auto');
    s.runTicks(1);
    s.cmd('A', startOffensive(id));
    let done = false;
    for (let t = 0; t < 1500 && !done; t += 1) {
      s.runAuto(1);
      done ||= s.state.events.some((e) => e.t === 'offensiveDone');
      expect(neutralEdges(s, id)).toEqual([]);
    }
    expect(done).toBe(true);
  }, 30_000);
});

describe('автослияние отрядов (04/T26)', () => {
  it('армия без плана сливает два однотипных отряда в одном гексе', () => {
    const s = scenario(MAP, { legend });
    const id = army(s, 2);
    const owned = s.state.armies.find((a) => a.id === id);
    if (owned) owned.auto = true;
    s.setTick((FRONT_ALLOC_TICKS - (id % FRONT_ALLOC_TICKS)) % FRONT_ALLOC_TICKS);
    frontSystem(s.state);
    expect(s.unitsOf('A').filter((u) => u.armyId === id)).toHaveLength(1);
  });

  it('после слияния лишних отрядов на линии не запускает обратное деление', () => {
    const s = scenario(MAP, { legend });
    const id = army(s, 3);
    const owned = s.state.armies.find((a) => a.id === id);
    if (owned) owned.auto = true;
    s.state.plans.push({ armyId: id, kind: 'line', hexes: [1 + 2 * 8] });
    s.setTick((FRONT_ALLOC_TICKS - (id % FRONT_ALLOC_TICKS)) % FRONT_ALLOC_TICKS);
    frontSystem(s.state);
    frontSystem(s.state);
    expect(s.unitsOf('A').filter((u) => u.armyId === id)).toHaveLength(1);
  });
});
