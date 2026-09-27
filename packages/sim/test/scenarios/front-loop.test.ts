import { describe, expect, it } from 'vitest';

import { intDiv } from '../../src/math/int.ts';
import { contourNext } from '../../src/state/contour.ts';
import { edgeHex, isBorderEdge, type EdgeId } from '../../src/state/edges.ts';
import { followEdges } from '../../src/state/front-follow.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

// Земля A — остров внутри земли B: своя граница — замкнутый контур. Остров 3 × 3.
const MAP = `
  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b
  b  b  b  a  a  a  b  b  b
  b  b  b  a  A1 a  b  b  b
  b  b  b  a  a  a  b  b  b
  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  B1
`;
// Остров 5 × 5: вмятина от захвата длиннее.
const BIG = `
  b  b  b  b  b  b  b  b  b
  b  b  a  a  a  a  a  b  b
  b  b  a  a  a  a  a  b  b
  b  b  a  a  A1 a  a  b  b
  b  b  a  a  a  a  a  b  b
  b  b  a  a  a  a  a  b  b
  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  b
  b  b  b  b  b  b  b  b  B1
`;
const legend = {
  A1: city('A', 5, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const W = 9;

// Контур своей границы по обходу, начиная с грани first.
function contour(g: ReturnType<typeof scenario>['state']): EdgeId[] {
  const start = g.hexes.owner.findIndex((o) => o === 0) * 6;
  const first = [0, 1, 2, 3, 4, 5]
    .map((d) => start + d)
    .find((e) => isBorderEdge(g, 0, e)) as EdgeId;
  const loop: EdgeId[] = [first];
  for (let e = contourNext(g, 0, first); e !== first; e = contourNext(g, 0, e)) loop.push(e);
  return loop;
}

describe('фронт на замкнутом контуре (риск 04/T13, приёмка 04/T14)', () => {
  it.each([
    ['3 × 3', MAP],
    ['5 × 5', BIG],
  ])(
    'остров %s: захват внутри участка больше половины контура — фронт с той же стороны',
    (_, map) => {
      const base = contour(scenario(map, { legend }).state);
      expect(base.length).toBeGreaterThan(10);
      let cases = 0;
      // Все сдвиги начала участка, доли 55–90 % контура, каждый гекс, все грани границы которого —
      // внутри участка, не у самых концов.
      for (let shift = 0; shift < base.length; shift += 1) {
        for (const share of [55, 70, 80, 90]) {
          const loop = [...base.slice(shift), ...base.slice(0, shift)];
          const front = loop.slice(0, intDiv(loop.length * share + 99, 100));
          const outside = loop.filter((e) => !front.includes(e));
          const inner = new Set(
            front
              .filter((_, i) => i > 1 && i < front.length - 2)
              .map(edgeHex)
              .filter((h) => loop.filter((x) => edgeHex(x) === h).every((x) => front.includes(x))),
          );
          for (const lost of inner) {
            const s = scenario(map, { legend });
            const g = s.state;
            s.setOwner(at(lost % W, intDiv(lost, W)), 'B');
            const moved = followEdges(g, 0, front);
            const where = `сдвиг ${shift}, доля ${share} %, гекс ${lost}`;
            expect(
              moved.every((e) => isBorderEdge(g, 0, e)),
              where,
            ).toBe(true);
            expect(
              moved.filter((e) => outside.includes(e)),
              where,
            ).toEqual([]);
            const kept = front.filter((e) => isBorderEdge(g, 0, e));
            expect(
              kept.every((e) => moved.includes(e)),
              where,
            ).toBe(true);
            cases += 1;
          }
        }
      }
      expect(cases).toBeGreaterThan(20);
    },
  );
});
