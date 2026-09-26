import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  distance,
  hexFromId,
  hexId,
  inBounds,
  isBorderHex,
  loadMap,
  neighbors,
  TERRAIN,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import {
  addPoints,
  draftCommand,
  draftPath,
  pointAt,
  type Draft,
  type DraftContext,
} from '../src/dev/plan-draft.ts';
import { frontEdges, offensiveEdges } from '../src/dev/plan-edges.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter, hexEdge, type Point } from '../src/render/hex-geometry.ts';
import { armyColor, playerLine } from '../src/theme/colors.ts';
import { tokens } from '../src/theme/tokens.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
const R = tokens.map.hexRadius;

function start(): { map: MapStatic; view: PlayerView } {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const e = createLocalEngine(small, 42, 2);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  const msg = e.tick();
  if (msg.t !== 'view') throw new Error('ожидался снимок');
  return { map: loaded.map, view: msg.view };
}

const around = (map: MapStatic, h: number): number[] =>
  neighbors(hexFromId(h, map.width)).flatMap((n) =>
    inBounds(n, map.width, map.height) ? [hexId(n, map.width)] : [],
  );

// Середина грани между гексом и соседом — точка «пальца».
function edgeMid(map: MapStatic, h: number, other: number): Point {
  const dir = neighbors(hexFromId(h, map.width)).findIndex(
    (n) => inBounds(n, map.width, map.height) && hexId(n, map.width) === other,
  );
  const [a, b] = hexEdge(hexCenter(hexFromId(h, map.width), R), R, dir);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const land = (map: MapStatic, h: number): boolean => map.terrain[h] !== TERRAIN.water;

describe('рисование планов по граням (CR-003)', () => {
  const { map, view } = start();
  const me = view.playerId;
  const ctx: DraftContext = { map, view, radius: R, front: [] };
  const ownBorder = view.hexes.owner.reduce<number[]>(
    (acc, _, id) => (isBorderHex({ map, hexes: view.hexes }, me, id) ? [...acc, id] : acc),
    [],
  );
  const b0 = ownBorder[0] ?? -1;
  const out0 = around(map, b0).find((n) => land(map, n) && view.hexes.owner[n] !== me) ?? -1;

  it('фронт: палец у грани своей границы с ничьей землёй даёт свой гекс этой грани', () => {
    expect(pointAt(ctx, 'front', edgeMid(map, b0, out0), false)).toEqual([b0]);
  });

  it('фронт: тап по границе с врагом — весь непрерывный кусок этой границы', () => {
    // Вся чужая суша вокруг — враг: граница с ним одна и непрерывная.
    const owner = Int16Array.from(view.hexes.owner, (o, id) =>
      o === me || !land(map, id) ? o : 1,
    );
    const enemyView = { ...view, hexes: { ...view.hexes, owner } };
    const c = { ...ctx, view: enemyView };
    const seg = pointAt(c, 'front', edgeMid(map, b0, out0), true);
    expect([...seg].sort((x, y) => x - y)).toEqual(ownBorder);
    expect(pointAt(c, 'front', edgeMid(map, b0, out0), false)).toEqual([b0]);
  });

  it('наступление: из двух гексов грани берётся тот, что ближе к фронту армии', () => {
    const c = { ...ctx, front: [b0] };
    expect(pointAt(c, 'offensive', edgeMid(map, b0, out0), false)).toEqual([b0]);
    const far =
      around(map, out0).find(
        (n) =>
          n !== b0 &&
          land(map, n) &&
          distance(hexFromId(n, map.width), hexFromId(b0, map.width)) === 2,
      ) ?? -1;
    expect(pointAt(c, 'offensive', edgeMid(map, out0, far), false)).toEqual([out0]);
  });

  it('линия обороны: только свои гексы суши', () => {
    const c = hexCenter(hexFromId(b0, map.width), R);
    expect(pointAt(ctx, 'line', c, true)).toEqual([b0]);
    expect(pointAt(ctx, 'line', hexCenter(hexFromId(out0, map.width), R), true)).toEqual([]);
  });

  it('точки без повторов подряд; «Готово» даёт команду своего режима', () => {
    let d: Draft = { mode: 'front', armyId: 3, points: [] };
    expect(draftCommand(d)).toBeNull();
    d = addPoints(addPoints(d, [b0, b0]), [b0]);
    expect(d.points).toEqual([b0]);
    expect(draftCommand(d)).toEqual({ t: 'assignFront', armyId: 3, points: [b0] });
    expect(draftCommand({ ...d, mode: 'line' })).toMatchObject({ t: 'setDefenseLine' });
    expect(draftCommand({ ...d, mode: 'offensive' })).toMatchObject({ t: 'setOffensiveLine' });
  });

  it('подсветка фронта — цепочка соседних гексов своей границы; грани смотрят наружу', () => {
    const a = ownBorder[0] ?? -1;
    const b = ownBorder.at(-1) ?? -1;
    const path = draftPath(ctx, { mode: 'front', armyId: 1, points: [a, b] });
    for (let i = 1; i < path.length; i += 1) {
      const p = hexFromId(path[i - 1] as number, map.width);
      expect(distance(p, hexFromId(path[i] as number, map.width))).toBe(1);
    }
    const edges = frontEdges({ map, owner: view.hexes.owner, me }, path);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(view.hexes.owner[e.other]).not.toBe(me);
  });

  it('кромка наступления — грани к соседям дальше от фронта', () => {
    const line = [out0];
    const edges = offensiveEdges(map, [b0], line);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(e.other).not.toBe(b0);
  });
});

describe('цвет армии', () => {
  it('из палитры игроков без своего цвета, по номеру армии, по кругу', () => {
    const pool = tokens.players.palette.length - 1;
    const colors = Array.from({ length: pool }, (_, i) => armyColor(0, i + 1));
    expect(colors).not.toContain(playerLine(0));
    expect(new Set(colors).size).toBe(pool);
    expect(armyColor(0, pool + 1)).toBe(colors[0]);
  });
});
