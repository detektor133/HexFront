import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  borderEdges,
  contourNext,
  contourPrev,
  edgeOther,
  flipEdge,
  hexId,
  inBounds,
  isBorderEdge,
  neighbors,
  TERRAIN,
  type MatchState,
  canonicalEdge,
  frontSideDistance,
  hexFromId,
  lineDistance,
  planHexes,
  playerView,
} from '@hexfront/sim';

import { finishCommand, startDraft, strokeAdd } from '../src/dev/plan-draft.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter, type Point } from '../src/render/hex-geometry.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
/** Столица игрока 0 на карте small при сиде 42 и камера песочницы при 1440×900 (как в скриптах). */
const CAPITAL = 765;
const R = 20;
const SCALE = 2.5;
const CAM_X = 50;

// Три сцены приёмки 04/T14b — экранные точки линии, как в scripts/offensive-line-screens.ts.
const SCENES: readonly { name: string; line: Point[] }[] = [
  {
    name: 'прямая',
    line: [
      { x: 760, y: 230 },
      { x: 760, y: 560 },
    ],
  },
  {
    name: 'диагональная',
    line: [
      { x: 640, y: 120 },
      { x: 860, y: 560 },
    ],
  },
  {
    name: 'изогнутая',
    line: [
      { x: 690, y: 170 },
      { x: 790, y: 260 },
      { x: 830, y: 380 },
      { x: 800, y: 490 },
      { x: 740, y: 560 },
    ],
  },
];

// Точки росчерка между экранными точками (палец ведёт линию), в мировых координатах.
function strokePoints(pts: readonly Point[], capY: number): Point[] {
  const camY = 450 - capY * SCALE;
  const out: Point[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    for (let k = i === 1 ? 0 : 1; k <= 20; k += 1) {
      const x = a.x + ((b.x - a.x) * k) / 20;
      const y = a.y + ((b.y - a.y) * k) / 20;
      out.push({ x: (x - CAM_X) / SCALE, y: (y - camY) / SCALE });
    }
  }
  return out;
}

type State = MatchState;

// Чужие проходимые гексы в «дырах» своей земли: связные куски не своих гексов (вода — тоже), не
// касающиеся края карты.
function enclosed(st: State, owner: number): number[] {
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
      for (const n of neighbors(hexFromId(h, width))) {
        if (!inBounds(n, width, height)) {
          edge = true;
          continue;
        }
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

// Соседние грани фронта — соседние по обходу контура; иначе — дыра (кроме обрыва контура).
function arcGaps(st: State, owner: number, front: readonly number[]): string[] {
  const gaps: string[] = [];
  for (let i = 1; i < front.length; i += 1) {
    const a = front[i - 1] as number;
    const b = front[i] as number;
    const next = contourNext(st, owner, a);
    const prev = contourPrev(st, owner, a);
    if (next === b || prev === b || next < 0 || prev < 0) continue;
    gaps.push(`${a}→${b}`);
  }
  return gaps;
}

describe('наступление в песочнице без сопротивления (04/T14b)', () => {
  it.each(SCENES)(
    '$name линия: вся линия взята, за линию и назад — ни шага, фронт — дуга по линии',
    (sc) => {
      const e = createLocalEngine(small, 42, 2);
      if ('errors' in e) throw new Error(e.errors.join('\n'));
      const s = e.state;
      const run = (seconds: number): void => {
        for (let i = 0; i < seconds * 10; i += 1) e.tick();
      };
      run(3);
      const army = s.armies.find((a) => a.owner === 0)?.id ?? -1;
      e.queue({ t: 'assignFront', armyId: army, edges: borderEdges(s, 0) });
      run(6);
      const capY = hexCenter(hexFromId(CAPITAL, s.map.width), R).y;
      const c = { map: s.map, view: playerView(s, 0), radius: R };
      let d = startDraft('offensive', army);
      for (const p of strokePoints(sc.line, capY)) d = strokeAdd(c, d, p);
      const cmd = finishCommand(d);
      if (!cmd) throw new Error('линия не нарисована');
      e.queue(cmd);
      run(0.1);
      const plan = s.plans.find((p) => p.armyId === army);
      if (plan?.kind !== 'front' || !plan.offensive) throw new Error('нет линии');
      const { hexes, edges } = plan.offensive;
      const dt = lineDistance(s, hexes);
      const side = frontSideDistance(s, planHexes(s, plan), edges);
      e.queue({ t: 'startOffensive', armyId: army });
      run(0.1);
      // Хвосты стрелок — на гранях фронта, смотрящих на линию: гекс за гранью ближе к линии.
      const pv = playerView(s, 0).plans.find((p) => p.armyId === army);
      const facing = pv?.kind === 'front' ? pv.facing : [];
      expect(facing.length).toBeGreaterThan(0);
      for (const f of facing) {
        const other = edgeOther(s, f);
        const self = dt[Math.floor(f / 6)] as number;
        const beyond = dt[other] as number;
        expect(beyond < self || (beyond === 0 && self === 0)).toBe(true);
      }
      // Захваты: откуда (последний свой гекс отряда) и куда.
      const origin = new Map<number, number>();
      const caps: { from: number; to: number; enclave: boolean }[] = [];
      for (
        let t = 0;
        t < 3000 && s.plans.find((p) => p.armyId === army)?.kind === 'front';
        t += 1
      ) {
        const owners = s.hexes.owner.slice();
        const holes = new Set(enclosed(s, 0));
        for (const u of s.units) if (owners[u.hex] === 0) origin.set(u.id, u.hex);
        e.tick();
        for (const u of s.units) {
          const from = origin.get(u.id);
          if (u.owner !== 0 || from === undefined || owners[u.hex] === 0) continue;
          if (s.hexes.owner[u.hex] === 0) caps.push({ from, to: u.hex, enclave: holes.has(u.hex) });
        }
        const now = s.plans.find((p) => p.armyId === army);
        if (now?.kind === 'front' && !now.offensive) break;
      }
      expect(hexes.every((h) => s.hexes.owner[h] === 0)).toBe(true);
      for (const x of caps) {
        const from = dt[x.from] as number;
        const to = dt[x.to] as number;
        // Ни одного шага назад: dt не растёт, не меняется — только вдоль линии; в анклав — при
        // любом dt.
        expect(x.enclave || to < from || (to === 0 && from === 0)).toBe(true);
        // Ни одного гекса за линией.
        expect(side[x.to]).toBeGreaterThanOrEqual(0);
      }
      const after = s.plans.find((p) => p.armyId === army);
      expect(after?.kind === 'front' && after.offensive).toBeNull();
      const front = after?.kind === 'front' ? after.edges : [];
      expect(front.length).toBeGreaterThan(0);
      // Грани линии, ставшие границей, — во фронте; фронт — сплошная дуга; внутри своей земли
      // чужих гексов нет; «упёрлись» снят.
      const inFront = new Set(front.map((x) => canonicalEdge(s, x)));
      const border = edges.filter(
        (x) => isBorderEdge(s, 0, x) || isBorderEdge(s, 0, flipEdge(s, x)),
      );
      expect(border.filter((x) => !inFront.has(canonicalEdge(s, x)))).toEqual([]);
      expect(arcGaps(s, 0, front)).toEqual([]);
      expect(enclosed(s, 0)).toEqual([]);
      const view = playerView(s, 0).plans.find((p) => p.armyId === army);
      expect(view?.kind === 'front' && view.stuck).toBe(false);
    },
    // Прогон матча до 5 минут игрового времени на карте песочницы.
    30_000,
  );
});
