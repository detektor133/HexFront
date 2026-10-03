import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TERRAIN } from '../../src/map/types.ts';
import { hexFromId, hexId, inBounds, neighbors } from '../../src/math/hex.ts';
import { intDiv } from '../../src/math/int.ts';
import { playerView } from '../../src/queries/player-view.ts';
import { allocate } from '../../src/state/allocate.ts';
import { contourNext, contourPrev } from '../../src/state/contour.ts';
import { canonicalEdge } from '../../src/state/edge-line.ts';
import { flipEdge, isBorderEdge } from '../../src/state/edges.ts';
import { planHexes } from '../../src/state/front.ts';
import { facingHexes, frontSideDistance, lineDistance } from '../../src/state/offensive-steps.ts';
import {
  assignFront,
  assignUnits,
  at,
  city,
  createArmy,
  own,
  scenario,
  setOffensiveLine,
  startOffensive,
  type At,
} from '../scenario/dsl.ts';

// Страна A (столбцы 4–6, строки 4–6) внутри земли B; фронт — вся граница с B.
// Линия наступления — длинная и косая, восточнее страны: от (9, 0) до (13, 10).
const MAP = `
  b  b  b  b  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  a  a  a  b  b  b  b  b  b  b  b
  b  b  b  b  a  A1 a  b  b  b  b  b  b  b  b
  b  b  b  b  a  a  a  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b  b  b  b  B1
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const W = 15;
const LINE = [at(9, 0), at(10, 2), at(11, 4), at(11, 6), at(12, 8), at(13, 10)];

type S = ReturnType<typeof scenario>;

function start(map = MAP, line: readonly At[] = LINE, units = 8): { s: S; army: number } {
  const s = scenario(map, { legend });
  const capital = s.state.cities.find((c) => c.owner === 0)?.hex ?? 0;
  const w = s.state.map.width;
  const home = at(capital % w, intDiv(capital, w));
  const ids = Array.from({ length: units }, () => s.unit('A', 'infantry', 300, home));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(ids, army));
  s.cmd('A', assignFront(army, 'B', null));
  // Отряды расходятся по фронту вокруг всей страны.
  s.runSeconds(30);
  s.cmd('A', setOffensiveLine(army, line));
  s.runTicks(1);
  return { s, army };
}

function lineOf(s: S, army: number): number[] {
  const plan = s.state.plans.find((p) => p.armyId === army);
  return plan?.kind === 'front' ? [...(plan.offensive?.hexes ?? [])] : [];
}

/** Захват в наступлении: отряд вошёл в гекс, который до тика был не своим. */
interface Capture {
  readonly from: number;
  readonly to: number;
  /** Гекс был анклавом (чужой внутри своей земли) до захвата — шаг туда не зависит от dt. */
  readonly enclave: boolean;
}

// Прогон на ticks тиков с записью захватов: откуда (последний свой гекс отряда) и куда.
function run(s: S, ticks: number): Capture[] {
  const out: Capture[] = [];
  const origin = new Map<number, number>();
  for (let t = 0; t < ticks; t += 1) {
    const owners = s.state.hexes.owner.slice();
    const holes = new Set(enclosed(s.state, 0));
    for (const u of s.state.units) if (owners[u.hex] === 0) origin.set(u.id, u.hex);
    s.runTicks(1);
    for (const u of s.state.units) {
      const from = origin.get(u.id);
      if (u.owner !== 0 || from === undefined || owners[u.hex] === 0) continue;
      if (s.state.hexes.owner[u.hex] === 0) {
        out.push({ from, to: u.hex, enclave: holes.has(u.hex) });
      }
    }
  }
  return out;
}

const col = (h: number): number => h % W;

// Чужие проходимые гексы в «дырах» своей земли: связные куски не своих гексов (вода — тоже),
// не касающиеся края карты.
function enclosed(st: S['state'], owner: number): number[] {
  const { width, height } = st.map;
  const seen = new Uint8Array(width * height);
  const out: number[] = [];
  for (let h0 = 0; h0 < width * height; h0 += 1) {
    if (seen[h0] || st.hexes.owner[h0] === owner) continue;
    const comp = [h0];
    seen[h0] = 1;
    let edge = false;
    for (let i = 0; i < comp.length; i += 1) {
      const h = comp[i] as number;
      const c = h % width;
      const r = intDiv(h, width);
      if (c === 0 || r === 0 || c === width - 1 || r === height - 1) edge = true;
      for (const n of neighbors(hexFromId(h, width))) {
        if (!inBounds(n, width, height)) continue;
        const id = hexId(n, width);
        if (seen[id] || st.hexes.owner[id] === owner) continue;
        seen[id] = 1;
        comp.push(id);
      }
    }
    if (!edge) out.push(...comp.filter((h) => st.map.terrain[h] !== TERRAIN.water));
  }
  return out.sort((a, b) => a - b);
}

// Фронт — сплошная дуга контура своей границы: соседние грани фронта — соседние по обходу
// контура (в ту или другую сторону); иначе — разрыв, допустимый только там, где контур обрывается.
// Возвращает пары граней с дырой между ними.
function arcGaps(st: S['state'], owner: number, front: readonly number[]): string[] {
  const gaps: string[] = [];
  for (let i = 1; i < front.length; i += 1) {
    const a = front[i - 1] as number;
    const b = front[i] as number;
    const next = contourNext(st, owner, a);
    const prev = contourPrev(st, owner, a);
    if (next === b || prev === b) continue;
    if (next < 0 || prev < 0) continue;
    gaps.push(`${a}→${b}`);
  }
  return gaps;
}

// Захват ведёт к линии: dt строго меньше или шаг вдоль линии (dt 0 → 0).
function toward(dt: Int32Array, c: Capture): boolean {
  const from = dt[c.from] as number;
  const to = dt[c.to] as number;
  return c.enclave || (to >= 0 && (to < from || (to === 0 && from === 0)));
}

describe('наступление только к линии (04/T14b)', () => {
  it('фронт вокруг страны, длинная косая линия: гексы с обратной стороны не берутся', () => {
    const { s, army } = start();
    s.cmd('A', startOffensive(army));
    const taken = run(s, 600).map((c) => c.to);
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.filter((h) => col(h) < 4)).toEqual([]);
  });

  it('dt не растёт; не меняется — только при шаге вдоль линии', () => {
    const { s, army } = start();
    const dt = lineDistance(s.state, lineOf(s, army));
    s.cmd('A', startOffensive(army));
    const away = run(s, 600).filter((c) => !toward(dt, c));
    expect(away).toEqual([]);
  });

  it('отряды на гранях, не смотрящих на линию, не наступают', () => {
    const { s, army } = start();
    const plan = s.state.plans.find((p) => p.armyId === army);
    const dt = lineDistance(s.state, lineOf(s, army));
    const facing = new Set(plan?.kind === 'front' ? facingHexes(s.state, plan.edges, dt) : []);
    // Грани запада страны на линию не смотрят: у (4, 5) и (4, 6) соседи за границей не ближе.
    expect(facing.size).toBeGreaterThan(0);
    expect(facing.has(4 + 5 * W)).toBe(false);
    expect(facing.has(4 + 6 * W)).toBe(false);
    s.cmd('A', startOffensive(army));
    // Шаги с исходной земли страны — только с гексов смотрящих граней.
    const home = new Set(
      [...s.state.hexes.owner.keys()].filter((h) => s.state.hexes.owner[h] === 0),
    );
    const first = run(s, 600).filter((c) => home.has(c.from));
    expect(first.length).toBeGreaterThan(0);
    for (const c of first) expect(facing.has(c.from)).toBe(true);
  });

  it('за линию никто не заходит: каждый взятый гекс — со стороны фронта', () => {
    const { s, army } = start();
    const plan = s.state.plans.find((p) => p.armyId === army);
    if (plan?.kind !== 'front' || !plan.offensive) throw new Error('нет линии');
    const side = frontSideDistance(s.state, planHexes(s.state, plan), plan.offensive.edges);
    s.cmd('A', startOffensive(army));
    const caps = run(s, 1500);
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) expect(side[c.to]).toBeGreaterThanOrEqual(0);
  });

  it('завершено — ни одного чужого гекса внутри своей земли, фронт — сплошная дуга, «упёрлись» снят', () => {
    for (const line of [LINE, [at(10, 1), at(10, 9)]]) {
      const { s, army } = start(MAP, line);
      s.cmd('A', startOffensive(army));
      s.runSeconds(300);
      const after = s.state.plans.find((p) => p.armyId === army);
      expect(after?.kind === 'front' && after.offensive).toBeNull();
      expect(enclosed(s.state, 0)).toEqual([]);
      const front = after?.kind === 'front' ? after.edges : [];
      expect(arcGaps(s.state, 0, front)).toEqual([]);
      const view = playerView(s.state, 0).plans.find((p) => p.armyId === army);
      expect(view?.kind === 'front' && view.stuck).toBe(false);
    }
  }, 20_000);

  it('вся линия своя — наступление завершено, грани линии, ставшие границей, — во фронте', () => {
    const { s, army } = start();
    const plan = s.state.plans.find((p) => p.armyId === army);
    if (plan?.kind !== 'front' || !plan.offensive) throw new Error('нет линии');
    const { hexes, edges } = plan.offensive;
    s.cmd('A', startOffensive(army));
    s.runSeconds(300);
    expect(hexes.every((h) => s.state.hexes.owner[h] === 0)).toBe(true);
    const after = s.state.plans.find((p) => p.armyId === army);
    expect(after?.kind === 'front' && after.offensive).toBeNull();
    const front = new Set(
      (after?.kind === 'front' ? after.edges : []).map((e) => canonicalEdge(s.state, e)),
    );
    const border = edges.filter(
      (e) => isBorderEdge(s.state, 0, e) || isBorderEdge(s.state, 0, flipEdge(s.state, e)),
    );
    expect(border.length).toBeGreaterThan(0);
    expect(border.filter((e) => !front.has(canonicalEdge(s.state, e)))).toEqual([]);
  });

  it('идёт наступление — на гексах смотрящих граней отрядов больше, чем без него', () => {
    const { s, army } = start(MAP, LINE, 5);
    const plan = s.state.plans.find((p) => p.armyId === army);
    if (plan?.kind !== 'front' || !plan.offensive) throw new Error('нет линии');
    const dt = lineDistance(s.state, plan.offensive.hexes);
    const facing = new Set(facingHexes(s.state, plan.edges, dt));
    const onFacing = (active: boolean): number => {
      const p = { ...plan, offensive: { ...plan.offensive, active } } as typeof plan;
      return [...allocate(s.state, p, 0).slots.values()].filter((h) => facing.has(h)).length;
    };
    expect(onFacing(true)).toBeGreaterThan(onFacing(false));
  });

  it('«упёрлись»: 10 с без шага и боя — флаг в снимке; шаг снова возможен — флаг снят', () => {
    const { s, army } = start();
    // Кольцо сильного врага вокруг страны: прогноз «Поражение», шагнуть некуда, боя нет.
    const ring: At[] = [];
    for (let r = 3; r <= 7; r += 1)
      for (let c = 3; c <= 7; c += 1) {
        if (c < 4 || c > 6 || r < 4 || r > 6) ring.push(at(c, r));
      }
    const walls = ring.map((w) => s.unit('B', 'infantry', 3000, w));
    s.cmd('A', startOffensive(army));
    const stuck = (): boolean =>
      playerView(s.state, 0).plans.some((p) => p.armyId === army && p.kind === 'front' && p.stuck);
    s.runSeconds(8);
    expect(stuck()).toBe(false);
    s.runSeconds(6);
    expect(stuck()).toBe(true);
    const gone = new Set(walls);
    s.state.units.splice(0, s.state.units.length, ...s.state.units.filter((u) => !gone.has(u.id)));
    s.runSeconds(3);
    expect(stuck()).toBe(false);
  });
});

// Случайная карта: земля A слева (столбцы 0..k), B справа, вода вкраплениями; линия — две точки
// на земле B.
const mapArb = fc
  .record({
    w: fc.integer({ min: 7, max: 10 }),
    h: fc.integer({ min: 5, max: 8 }),
    k: fc.integer({ min: 1, max: 2 }),
    water: fc.array(fc.nat(), { maxLength: 6 }),
    a: fc.nat(),
    b: fc.nat(),
  })
  .map(({ w, h, k, water, a, b }) => {
    const cells: string[][] = [];
    for (let r = 0; r < h; r += 1) {
      cells.push(Array.from({ length: w }, (_, c) => (c <= k ? 'a' : 'b')));
    }
    const put = (c: number, r: number, v: string): void => {
      (cells[r] as string[])[c] = v;
    };
    for (const x of water) put(k + 2 + (x % (w - k - 3)), intDiv(x, w) % h, '~');
    put(0, intDiv(h, 2), 'A1');
    put(w - 1, h - 1, 'B1');
    const lc = (x: number): number => k + 3 + (x % (w - k - 4));
    const line = [at(lc(a), 0), at(lc(b), h - 1)];
    for (const p of line) put(p.col, p.row, 'b');
    return { map: cells.map((row) => row.join(' ')).join('\n'), line };
  });

describe('наступление только к линии: случайные карты (04/T14b)', () => {
  it('ни один захват в наступлении не увеличивает dt; не меняет — только вдоль линии', () => {
    fc.assert(
      fc.property(mapArb, ({ map, line }) => {
        const { s, army } = start(map, line, 4);
        const plan = lineOf(s, army);
        if (plan.length === 0) return;
        const dt = lineDistance(s.state, plan);
        s.cmd('A', startOffensive(army));
        for (const c of run(s, 300)) {
          expect(toward(dt, c)).toBe(true);
        }
        const done = s.state.plans.find((p) => p.armyId === army);
        if (done?.kind === 'front' && !done.offensive) expect(enclosed(s.state, 0)).toEqual([]);
      }),
      { numRuns: 25, seed: 7 },
    );
  });
});
