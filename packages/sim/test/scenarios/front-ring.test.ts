import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { intDiv } from '../../src/math/int.ts';
import { contourNext } from '../../src/state/contour.ts';
import { edgeHex, edgeOther, isBorderEdge, type EdgeId } from '../../src/state/edges.ts';
import {
  assignUnits,
  at,
  city,
  createArmy,
  own,
  raw,
  scenario,
  setOffensiveLine,
  startOffensive,
} from '../scenario/dsl.ts';

// Страна A (столбцы 3–7, строки 3–6) внутри земли B: своя граница — замкнутый контур.
const MAP = `
  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  a  a  a  a  a  b  b  b
  b  b  b  a  a  A1 a  a  b  b  b
  b  b  b  a  a  a  a  a  b  b  b
  b  b  b  a  a  a  a  a  b  b  b
  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b  b  B1
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const W = 11;

type S = ReturnType<typeof scenario>;

// Контур своей границы от грани e по обходу; loop — вернулись в e.
function contourFrom(s: S, e: EdgeId): { edges: EdgeId[]; loop: boolean } {
  const out: EdgeId[] = [e];
  for (let x = contourNext(s.state, 0, e); x >= 0; x = contourNext(s.state, 0, x)) {
    if (x === e) return { edges: out, loop: true };
    if (out.length > 4 * s.state.hexes.owner.length) break;
    out.push(x);
  }
  return { edges: out, loop: false };
}

// Фронт замкнут: покрывает весь замкнутый контур, на котором лежит.
function closed(s: S, front: readonly EdgeId[]): boolean {
  const [first] = front;
  if (first === undefined || !isBorderEdge(s.state, 0, first)) return false;
  const c = contourFrom(s, first);
  const set = new Set(front);
  return c.loop && c.edges.every((e) => set.has(e));
}

function frontOf(s: S, army: number): EdgeId[] {
  const p = s.state.plans.find((x) => x.armyId === army);
  return p?.kind === 'front' ? [...p.edges] : [];
}

// Армия с фронтом на восточной части контура (треть контура, не замкнут).
function start(): { s: S; army: number } {
  const s = scenario(MAP, { legend });
  const ids = [0, 1, 2].map(() => s.unit('A', 'infantry', 300, at(5, 4)));
  s.cmd('A', createArmy(''));
  s.runTicks(1);
  const army = s.armiesOf('A').at(-1)?.id ?? -1;
  s.cmd('A', assignUnits(ids, army));
  const east = (7 + 4 * W) * 6;
  const first = [0, 1, 2, 3, 4, 5].map((d) => east + d).find((e) => isBorderEdge(s.state, 0, e));
  if (first === undefined) throw new Error('нет границы');
  const loop = contourFrom(s, first).edges;
  s.cmd('A', raw({ t: 'assignFront', armyId: army, edges: loop.slice(0, intDiv(loop.length, 3)) }));
  s.runTicks(1);
  return { s, army };
}

// Гексы, которые можно взять (чужие у своей земли) или потерять (свои у чужой, не столица).
function frontierHexes(s: S, mine: boolean): number[] {
  const out: number[] = [];
  const g = s.state;
  for (let h = 0; h < g.hexes.owner.length; h += 1) {
    if ((g.hexes.owner[h] === 0) !== mine) continue;
    if (mine && g.cities.some((c) => c.hex === h)) continue;
    const touches = [0, 1, 2, 3, 4, 5].some((d) => {
      const n = edgeOther(g, h * 6 + d);
      return n >= 0 && (g.hexes.owner[n] === 0) !== mine;
    });
    if (touches) out.push(h);
  }
  return out;
}

const event = fc.record({ take: fc.boolean(), pick: fc.nat() });

// Проигрывает события (захват/потеря гекса по номеру в списке возможных) и возвращает фронт.
function play(events: readonly { take: boolean; pick: number }[]): { s: S; front: EdgeId[] } {
  const { s, army } = start();
  for (const e of events) {
    const pool = frontierHexes(s, !e.take);
    const h = pool[e.pick % Math.max(1, pool.length)];
    if (h !== undefined) s.setOwner(at(h % W, intDiv(h, W)), e.take ? 'A' : 'B');
  }
  return { s, front: frontOf(s, army) };
}

describe('фронт не закольцовывается (04/T18)', () => {
  it('страну разрезало: фронт остаётся на части со столицей, не замыкается вокруг кармана', () => {
    // Потеря (6, 4) отрезает карман (7, 3)–(7, 4), потеря (7, 4) оставляет в нём один гекс.
    const { s, front } = play([
      { take: true, pick: 0 },
      { take: false, pick: 394116649 },
      { take: false, pick: 499376154 },
      { take: false, pick: 732870516 },
      { take: false, pick: 0 },
      { take: false, pick: 466027217 },
    ]);
    expect(closed(s, front)).toBe(false);
    expect(front.every((e) => edgeHex(e) !== 7 + 3 * W)).toBe(true);
  });

  it('выступ дошёл до края карты: фронт — два куска до обрыва, а не вокруг всей страны', () => {
    // Захват (4, 0) доводит выступ (4, 2)–(4, 1) до верхнего края: контур открывается между
    // концами фронта.
    const { front } = play([
      { take: true, pick: 298514302 },
      { take: true, pick: 0 },
      { take: true, pick: 0 },
    ]);
    // Фронт был на северо-востоке — на юг страны (строка 6) и её запад (столбец 3) он не уходит.
    expect(front.filter((e) => intDiv(edgeHex(e), W) >= 6)).toEqual([]);
    expect(front.length).toBeLessThanOrEqual(20);
  });

  it('случайные захваты и потери: незамкнутый фронт не замыкается', () => {
    fc.assert(
      fc.property(fc.array(event, { minLength: 1, maxLength: 25 }), (events) => {
        const { s, army } = start();
        expect(closed(s, frontOf(s, army))).toBe(false);
        for (const [i, e] of events.entries()) {
          const pool = frontierHexes(s, !e.take);
          const h = pool[e.pick % Math.max(1, pool.length)];
          if (h === undefined) continue;
          s.setOwner(at(h % W, intDiv(h, W)), e.take ? 'A' : 'B');
          const now = frontOf(s, army);
          const where = `шаг ${i}: ${e.take ? 'взят' : 'потерян'} ${h % W},${intDiv(h, W)}`;
          expect(closed(s, now), where).toBe(false);
          expect(now.length, where).toBeGreaterThan(0);
        }
      }),
      { numRuns: 400, seed: 18 },
    );
  });

  it('наступление к линии на востоке: после завершения фронт не замкнут', () => {
    fc.assert(
      fc.property(fc.integer({ min: 8, max: 10 }), fc.integer({ min: 0, max: 3 }), (col, top) => {
        const { s, army } = start();
        s.cmd('A', setOffensiveLine(army, [at(col, top), at(col, 9)]));
        s.runTicks(1);
        s.cmd('A', startOffensive(army));
        let prev = frontOf(s, army);
        for (let t = 0; t < 1200; t += 1) {
          s.runTicks(1);
          const now = frontOf(s, army);
          if (now.join() === prev.join()) continue;
          expect(closed(s, now), `тик ${t}`).toBe(false);
          prev = now;
        }
      }),
      { numRuns: 12, seed: 18 },
    );
    // 12 наступлений по 2 минуты игрового времени.
  }, 30_000);

  it('грани фронта всегда на своей границе', () => {
    const { s, army } = start();
    for (const e of frontOf(s, army))
      expect(isBorderEdge(s.state, 0, e), String(edgeHex(e))).toBe(true);
  });
});
