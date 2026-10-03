import { describe, expect, it } from 'vitest';

import { OFFENSIVE_FACING_RANGE } from '../../src/balance.ts';
import { distance, hexFromId } from '../../src/math/hex.ts';
import { intDiv } from '../../src/math/int.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { edgeHex } from '../../src/state/edges.ts';
import {
  assignFront,
  assignUnits,
  at,
  city,
  createArmy,
  drawFront,
  own,
  scenario,
  setOffensiveLine,
  startOffensive,
} from '../scenario/dsl.ts';

// Длинная граница A|B по столбцам 2|3 на 13 строк; линия наступления — короткая, внизу справа.
// Без ограничения на гранях у самого верха гекс за границей тоже ближе к линии — удар шёл бы
// издалека вдоль всей границы.
const MAP = Array.from({ length: 13 }, (_, r) =>
  [
    r === 6 ? 'A1' : 'a',
    'a',
    'a',
    ...Array.from({ length: 8 }, (_, c) => (r === 6 && c === 7 ? 'B1' : 'b')),
  ].join(' '),
).join('\n');
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const LINE = [at(6, 9), at(6, 11)];

function start() {
  const s = scenario(MAP, { legend });
  const ids = Array.from({ length: 9 }, () => s.unit('A', 'infantry', 300, at(1, 6)));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(ids, army));
  s.cmd('A', assignFront(army, 'B', null));
  s.runSeconds(30);
  s.cmd('A', setOffensiveLine(army, LINE));
  s.runTicks(1);
  return { s, army };
}

type S = ReturnType<typeof scenario>;

// «Точки фронта у линии»: для каждого гекса линии — ближайшие к нему гексы фронта (вариант Б).
function anchors(s: S, army: number): number[] {
  const plan = s.state.plans.find((p) => p.armyId === army);
  if (plan?.kind !== 'front' || !plan.offensive) return [];
  const w = s.state.map.width;
  const front = [...new Set(plan.edges.map(edgeHex))];
  const out = new Set<number>();
  for (const l of plan.offensive.hexes) {
    const d = (h: number): number => distance(hexFromId(h, w), hexFromId(l, w));
    const min = Math.min(...front.map(d));
    for (const h of front) if (d(h) === min) out.add(h);
  }
  return [...out];
}

const near = (s: S, h: number, from: readonly number[]): boolean => {
  const w = s.state.map.width;
  return from.some((a) => distance(hexFromId(a, w), hexFromId(h, w)) <= OFFENSIVE_FACING_RANGE);
};

// Сцена 06:45 из песочницы: фронт идёт с севера вдоль ничьей земли и спускается к врагу; линия
// наступления — на юго-востоке. Северный кусок тоже «смотрит» на линию (гекс за гранью ближе), и
// без ограничения стрелка шла с севера через свою землю.
const SCENE_0645 = Array.from({ length: 16 }, (_, r) =>
  [
    r === 6 ? 'A1' : 'a',
    'a',
    'a',
    ...Array.from({ length: 8 }, (_, c) => (r < 6 ? '.' : r === 8 && c === 7 ? 'B1' : 'b')),
  ].join(' '),
).join('\n');

describe('смотрящие грани — не дальше 3 гексов от ближайшей к линии точки фронта (04/T22a)', () => {
  it('сцена 06:45: северный фронт по ничьей земле не даёт ни хвостов стрелок, ни шагов', () => {
    const s = scenario(SCENE_0645, { legend });
    const ids = Array.from({ length: 9 }, () => s.unit('A', 'infantry', 300, at(1, 6)));
    s.cmd('A', createArmy(''));
    s.runTicks(1);
    const army = s.armiesOf('A').at(-1)?.id ?? -1;
    s.cmd('A', assignUnits(ids, army));
    s.cmd('A', drawFront(army, [at(2, 0), at(2, 15)]));
    s.runSeconds(30);
    s.cmd('A', setOffensiveLine(army, [at(6, 12), at(6, 14)]));
    s.runTicks(1);
    const w = s.state.map.width;
    // Северный кусок — вдоль ничьей земли (строки 0–5).
    const north = (h: number): boolean => intDiv(h, w) < 6;
    const plan = playerView(s.state, 0).plans.find((p) => p.armyId === army);
    const edges = plan?.kind === 'front' ? plan.edges : [];
    // Фронт действительно тянется на север вдоль ничьей земли.
    expect(edges.filter((e) => north(edgeHex(e))).length).toBeGreaterThan(3);
    const facing = plan?.kind === 'front' ? plan.facing : [];
    expect(facing.length).toBeGreaterThan(0);
    expect(facing.filter((e) => north(edgeHex(e)))).toEqual([]);
    const home = new Set(
      [...s.state.hexes.owner.keys()].filter((h) => s.state.hexes.owner[h] === 0),
    );
    s.cmd('A', startOffensive(army));
    const starts: number[] = [];
    for (let t = 0; t < 400; t += 1) {
      const before = new Map(s.state.units.map((u) => [u.id, u.hex]));
      s.runTicks(1);
      for (const u of s.state.units) {
        const was = before.get(u.id);
        if (u.owner === 0 && was !== undefined && home.has(was) && !home.has(u.hex))
          starts.push(was);
      }
    }
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.filter(north)).toEqual([]);
  }, 30_000);

  it('длинный фронт: хвосты стрелок (facing в снимке) — только у точек фронта, ближайших к линии', () => {
    const { s, army } = start();
    const plan = playerView(s.state, 0).plans.find((p) => p.armyId === army);
    const facing = plan?.kind === 'front' ? plan.facing : [];
    expect(OFFENSIVE_FACING_RANGE).toBe(3);
    expect(facing.length).toBeGreaterThan(0);
    const from = anchors(s, army);
    for (const e of facing) expect(near(s, edgeHex(e), from)).toBe(true);
  });

  it('наступают только отряды у ближайшей к линии точки фронта', () => {
    const { s, army } = start();
    const from = anchors(s, army);
    const home = new Set(
      [...s.state.hexes.owner.keys()].filter((h) => s.state.hexes.owner[h] === 0),
    );
    s.cmd('A', startOffensive(army));
    const starts: number[] = [];
    for (let t = 0; t < 400; t += 1) {
      const before = new Map(s.state.units.map((u) => [u.id, u.hex]));
      s.runTicks(1);
      for (const u of s.state.units) {
        const was = before.get(u.id);
        if (u.owner === 0 && was !== undefined && home.has(was) && !home.has(u.hex))
          starts.push(was);
      }
    }
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.filter((h) => !near(s, h, from))).toEqual([]);
  }, 30_000);
});
