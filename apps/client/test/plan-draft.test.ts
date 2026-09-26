import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  borderEdges,
  edgeHex,
  edgeOther,
  hexFromId,
  isBorderEdge,
  loadMap,
  TERRAIN,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import {
  dragFrontEnd,
  finishCommand,
  startDraft,
  strokeAdd,
  tapCommand,
  type DraftContext,
} from '../src/dev/plan-draft.ts';
import { edgeMid, edgeRuns } from '../src/dev/plan-edges.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { armyColor, relationColor } from '../src/theme/colors.ts';
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

describe('инструменты планов по граням (CR-004)', () => {
  const { map, view } = start();
  const me = view.playerId;
  const c: DraftContext = { map, view, radius: R };
  const border = borderEdges({ map, hexes: view.hexes }, me);
  const e0 = border[0] ?? -1;

  it('палец у грани своей границы добавляет именно эту грань, отпустил — приказ фронта', () => {
    let d = startDraft('front', 7);
    d = strokeAdd(c, d, edgeMid(map, R, e0));
    d = strokeAdd(c, d, edgeMid(map, R, e0));
    expect(d.edges).toEqual([e0]);
    expect(finishCommand(d)).toEqual({ t: 'assignFront', armyId: 7, edges: [e0] });
  });

  it('тап по грани границы с ничьей землёй — фронт из одной грани', () => {
    expect(tapCommand(c, startDraft('front', 7), edgeMid(map, R, e0))).toEqual({
      t: 'assignFront',
      armyId: 7,
      edges: [e0],
    });
  });

  it('тап по границе с врагом — весь непрерывный кусок', () => {
    const owner = Int16Array.from(view.hexes.owner, (o, id) =>
      o === me || map.terrain[id] === TERRAIN.water ? o : 1,
    );
    const v = { ...view, hexes: { ...view.hexes, owner } };
    const cmd = tapCommand({ ...c, view: v }, startDraft('front', 7), edgeMid(map, R, e0));
    const edges = cmd?.t === 'assignFront' ? cmd.edges : [];
    expect(edges.length).toBeGreaterThan(1);
    const gv = { map, hexes: v.hexes };
    for (const e of edges) {
      expect(isBorderEdge(gv, me, e)).toBe(true);
      expect(v.hexes.owner[edgeOther(gv, e)]).toBe(1);
    }
  });

  it('линия наступления — грани под пальцем; «Удалить» — тап по линии даёт приказ', () => {
    // Палец ведёт от угла к углу: грани между ними — цепочка без ответвлений.
    const far = border.find((e) => edgeHex(e) !== edgeHex(e0)) ?? e0;
    let d = strokeAdd(c, startDraft('offensive', 3), edgeMid(map, R, e0));
    expect(finishCommand(d)).toBeNull();
    d = strokeAdd(c, d, edgeMid(map, R, far));
    expect(d.edges.length).toBeGreaterThan(0);
    expect(finishCommand(d)).toMatchObject({ t: 'setOffensiveLine', armyId: 3 });
    const plan = { armyId: 3, kind: 'front' as const, edges: [e0], hexes: [], offensive: null };
    const withPlan = { ...view, plans: [{ ...plan, zone: [] }] };
    const erase = startDraft('erase', 3);
    expect(tapCommand({ ...c, view: withPlan }, erase, edgeMid(map, R, e0))).toEqual({
      t: 'clearPlan',
      armyId: 3,
    });
    expect(tapCommand(c, erase, edgeMid(map, R, e0))).toBeNull();
  });

  it('линия обороны — только свои гексы', () => {
    const own = edgeHex(e0);
    const d = strokeAdd(c, startDraft('line', 1), hexCenter(hexFromId(own, map.width), R));
    expect(d.hexes).toEqual([own]);
  });

  it('ручка конца: тянем наружу — участок длиннее по границе, внутрь — короче', () => {
    const far = border.find((e) => edgeHex(e) !== edgeHex(e0)) ?? e0;
    const longer = dragFrontEnd(c, [e0], 1, edgeMid(map, R, far));
    expect(longer[0]).toBe(e0);
    expect(longer.at(-1)).toBe(far);
    expect(dragFrontEnd(c, longer, 1, edgeMid(map, R, e0))).toEqual([e0]);
  });

  it('ломаные граней: связный кусок фронта — одна ломаная', () => {
    const far = border.find((e) => edgeHex(e) !== edgeHex(e0)) ?? e0;
    const chain = dragFrontEnd(c, [e0], 1, edgeMid(map, R, far));
    expect(edgeRuns(map, R, chain).length).toBe(1);
  });
});

describe('цвета', () => {
  it('армии — своя палитра по номеру, по кругу; не совпадает с цветами отношений', () => {
    const pool = tokens.armies.palette.length;
    const colors = Array.from({ length: pool }, (_, i) => armyColor(i + 1));
    expect(new Set(colors).size).toBe(pool);
    expect(armyColor(pool + 1)).toBe(colors[0]);
    const { own, ally, enemy } = tokens.relation;
    for (const x of [own, ally, enemy]) expect(colors).not.toContain(x);
  });

  it('фишки: свои — зелёные, чужие — красные', () => {
    expect(relationColor(0, 0)).toBe(tokens.relation.own);
    expect(relationColor(1, 0)).toBe(tokens.relation.enemy);
  });
});
