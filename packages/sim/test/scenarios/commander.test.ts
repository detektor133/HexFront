import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { decide } from '../../src/bots/commander.ts';
import { distance, hexFromId } from '../../src/math/hex.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { edgeHex, edgeOther } from '../../src/state/edges.ts';
import {
  assignFront,
  assignUnits,
  at,
  city,
  createArmy,
  own,
  scenario,
  startOffensive,
  type At,
} from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
  n1: city(null, 1),
  n5: city(null, 5),
};

type S = ReturnType<typeof scenario>;

// Армия игрока A с отрядами в гексе where (передача — как от commander, auto не выключает).
function autoArmy(s: S, n: number, where: At = at(1, 2), soldiers = 300): number {
  const ids = Array.from({ length: n }, () => s.unit('A', 'infantry', soldiers, where));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(ids, army), 'auto');
  s.runTicks(1);
  return army;
}

const planOf = (s: S, army: number) => s.state.plans.find((p) => p.armyId === army);
const ownedBy = (s: S, player: number): number =>
  s.state.hexes.owner.filter((o) => o === player).length;

// A — у левого края, вокруг ничья земля; B далеко.
const OPEN = `
  .  .  .  .  .  .  .  .  .
  a  a  .  .  .  .  .  .  .
  A1 a  .  .  .  .  .  .  .
  a  a  .  .  .  .  .  .  .
  .  .  .  .  .  .  .  .  B1
`;

// A в середине большого поля ничьей земли; B в углу.
const WIDE = `
  .  .  .  .  .  .  .  .  .  .  .
  .  .  .  .  .  .  .  .  .  .  .
  .  .  .  .  .  .  .  .  .  .  .
  .  .  .  .  a  a  .  .  .  .  .
  .  .  .  .  a  A1 a  .  .  .  .
  .  .  .  .  a  a  .  .  .  .  .
  .  .  .  .  .  .  .  .  .  .  .
  .  .  .  .  .  .  .  .  .  .  .
  .  .  .  .  .  .  .  .  .  .  B1
`;

// A и B граничат по столбцам 2 и 3.
const FIELD = `
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
  A1 a  a  b  b  b  b  B1
  a  a  a  b  b  b  b  b
  a  a  a  b  b  b  b  b
`;

describe('commander: ничья земля (04/T21, CR-006)', () => {
  it('армия с auto за 30 с занимает ничьи гексы у своей границы, без плана', () => {
    const s = scenario(OPEN, { legend });
    const army = autoArmy(s, 2);
    const before = ownedBy(s, 0);
    s.runAuto(300);
    expect(ownedBy(s, 0)).toBeGreaterThan(before + 2);
    expect(planOf(s, army)).toBeUndefined();
  });

  it('ничья земля растёт кольцом вокруг столицы, а не коридором от отрядов', () => {
    const s = scenario(WIDE, { legend });
    autoArmy(s, 2, at(5, 4));
    s.runAuto(600);
    const w = s.state.map.width;
    const capital = hexFromId(5 + 4 * w, w);
    const dist = (h: number): number => distance(hexFromId(h, w), capital);
    const mine = [...s.state.hexes.owner.keys()].filter((h) => s.state.hexes.owner[h] === 0);
    expect(mine.length).toBeGreaterThan(9);
    const far = Math.max(...mine.map(dist));
    // Все гексы ближе внешнего кольца уже свои: земля без дыр и «змей».
    const inner = [...s.state.hexes.owner.keys()].filter((h) => dist(h) < far - 1);
    for (const h of inner) expect(s.state.hexes.owner[h]).toBe(0);
  });

  it('нейтральный город при прогнозе «успех» — цель раньше пустых гексов', () => {
    const s = scenario(
      `
      a  a  .  .  .  .
      A1 a  n1 .  .  .
      a  a  .  .  .  B1
    `,
      { legend },
    );
    const army = autoArmy(s, 1, at(1, 1), 600);
    const cmds = decide(s.state.map, playerView(s.state, 0), army);
    const cityHex = 2 + 1 * 6;
    const toCity = cmds.some(
      (c) => (c.t === 'move' && c.to === cityHex) || (c.t === 'attack' && c.target === cityHex),
    );
    expect(toCity).toBe(true);
  });

  it('при другом прогнозе нейтральный город не штурмуется', () => {
    const s = scenario(
      `
      a  a  .  .  .  .
      A1 a  n5 .  .  .
      a  a  .  .  .  B1
    `,
      { legend },
    );
    const army = autoArmy(s, 1, at(1, 1), 50);
    const cityHex = 2 + 1 * 6;
    const cmds = decide(s.state.map, playerView(s.state, 0), army);
    const toCity = cmds.some(
      (c) => (c.t === 'move' && c.to === cityHex) || (c.t === 'attack' && c.target === cityHex),
    );
    expect(toCity).toBe(false);
  });
});

describe('commander: война (04/T21, CR-006)', () => {
  it('сосед в войне — фронт на кусок границы с ним; на кусок — не больше одной армии', () => {
    const s = scenario(FIELD, { legend });
    const first = autoArmy(s, 2);
    const second = autoArmy(s, 2);
    s.runAuto(20);
    const withFront = [first, second].filter((a) => planOf(s, a)?.kind === 'front');
    expect(withFront).toHaveLength(1);
    const plan = planOf(s, withFront[0] as number);
    const edges = plan?.kind === 'front' ? plan.edges : [];
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(s.state.hexes.owner[edgeOther(s.state, e)]).toBe(1);
  });

  it('лишние отряды резерва уходят в самую слабую армию', () => {
    const s = scenario(FIELD, { legend });
    autoArmy(s, 3);
    const small = autoArmy(s, 1);
    const reserve = s.unit('A', 'infantry', 100, at(0, 0));
    s.runAuto(20);
    expect(s.unitById(reserve)?.armyId).toBe(small);
  });

  it('потерянный гекс у фронта армия отбивает, вглубь врага сама не идёт', () => {
    const s = scenario(FIELD, { legend });
    const army = autoArmy(s, 4);
    s.runAuto(100);
    expect(planOf(s, army)?.kind).toBe('front');
    const lostHex = 2 + 2 * 8;
    const plan = planOf(s, army);
    const onFront = plan?.kind === 'front' && plan.edges.some((e) => edgeHex(e) === lostHex);
    expect(onFront).toBe(true);
    s.setOwner(at(2, 2), 'B');
    const after = planOf(s, army);
    expect(after?.kind === 'front' ? after.lost : []).toContain(lostHex);
    const bBefore = ownedBy(s, 1);
    s.runAuto(400);
    expect(s.owner(at(2, 2))).toBe('A');
    expect(ownedBy(s, 1)).toBe(bBefore - 1);
  });

  it('▶ у армии с auto без линии — линия на 3 гекса вглубь от фронта', () => {
    const s = scenario(FIELD, { legend });
    const army = autoArmy(s, 4);
    s.cmd('A', assignFront(army, 'B', null), 'auto');
    s.runTicks(1);
    s.cmd('A', startOffensive(army));
    s.runAuto(30);
    const plan = planOf(s, army);
    const off = plan?.kind === 'front' ? plan.offensive : null;
    expect(off).not.toBeNull();
    expect(off?.active).toBe(true);
    const w = s.state.map.width;
    for (const h of off?.hexes ?? []) expect(h % w).toBeLessThanOrEqual(2 + 3);
    expect(s.state.armies.find((a) => a.id === army)?.auto).toBe(true);
  });

  it('▶ без линии, вражеский город ближе 3 гексов — линия до него', () => {
    const s = scenario(
      `
      a  a  a  b  b  b  b  b
      a  a  a  b  b  b  b  b
      A1 a  a  b  B1 b  b  b
      a  a  a  b  b  b  b  b
      a  a  a  b  b  b  b  b
    `,
      { legend },
    );
    const army = autoArmy(s, 4);
    s.cmd('A', assignFront(army, 'B', null), 'auto');
    s.runTicks(1);
    s.cmd('A', startOffensive(army));
    s.runAuto(30);
    const plan = planOf(s, army);
    const off = plan?.kind === 'front' ? plan.offensive : null;
    const w = s.state.map.width;
    const cityAt = hexFromId(4 + 2 * w, w);
    expect(off?.hexes.length ?? 0).toBeGreaterThan(0);
    for (const h of off?.hexes ?? []) expect(h % w).toBeLessThanOrEqual(4);
    expect((off?.hexes ?? []).some((h) => distance(hexFromId(h, w), cityAt) <= 1)).toBe(true);
  });
});

describe('commander: детерминизм (04/T21, CR-006)', () => {
  it('одинаковый снимок — одинаковые команды', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), (ticks) => {
        const s = scenario(FIELD, { legend });
        const army = autoArmy(s, 3);
        s.runAuto(ticks);
        const view = playerView(s.state, 0);
        const copy = playerView(s.state, 0);
        expect(decide(s.state.map, view, army)).toEqual(decide(s.state.map, copy, army));
      }),
      { numRuns: 20, seed: 6 },
    );
  });
});
