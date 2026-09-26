import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  distance,
  hexFromId,
  loadMap,
  TERRAIN,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { draftCommand, draftPath, draftTap, type Draft } from '../src/dev/plan-draft.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { armyColor, playerLine } from '../src/theme/colors.ts';
import { tokens } from '../src/theme/tokens.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);

function start(): { map: MapStatic; view: PlayerView } {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const e = createLocalEngine(small, 42, 2);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  const msg = e.tick();
  if (msg.t !== 'view') throw new Error('ожидался снимок');
  return { map: loaded.map, view: msg.view };
}

describe('режимы рисования планов армии (CR-002)', () => {
  const { map, view } = start();
  const own = view.hexes.owner.reduce<number[]>(
    (acc, o, id) => (o === view.playerId ? [...acc, id] : acc),
    [],
  );
  const enemyHex = view.hexes.owner.findIndex((o) => o >= 0 && o !== view.playerId);
  const a = own[0] ?? -1;
  const b = own.at(-1) ?? -1;

  it('фронт: тап по земле соседа — вся граница с ним', () => {
    const d: Draft = { mode: 'front', armyId: 7, points: [] };
    const next = draftTap(map, view, d, enemyHex);
    expect(next.draft).toBeNull();
    expect(next.cmd).toEqual({
      t: 'assignFront',
      armyId: 7,
      enemyId: view.hexes.owner[enemyHex],
      section: null,
    });
  });

  it('фронт: два тапа по своей земле — участок', () => {
    const d: Draft = { mode: 'front', armyId: 7, points: [] };
    const first = draftTap(map, view, d, a);
    expect(first.cmd).toBeNull();
    expect(first.draft?.points).toEqual([a]);
    const second = draftTap(map, view, first.draft as Draft, b);
    expect(second.draft).toBeNull();
    expect(second.cmd).toMatchObject({ t: 'assignFront', armyId: 7, section: [a, b] });
  });

  it('линия: тапы добавляют точки, повтор той же точки не добавляет', () => {
    let d: Draft = { mode: 'line', armyId: 3, points: [] };
    expect(draftCommand(d)).toBeNull();
    for (const h of [a, a, b]) d = draftTap(map, view, d, h).draft as Draft;
    expect(d.points).toEqual([a, b]);
    expect(draftCommand(d)).toEqual({ t: 'setDefenseLine', armyId: 3, points: [a, b] });
    expect(draftCommand({ ...d, mode: 'offensive' })).toEqual({
      t: 'setOffensiveLine',
      armyId: 3,
      points: [a, b],
    });
  });

  it('вода и (для линии обороны) чужие гексы точками не становятся', () => {
    const water = map.terrain.findIndex((t) => t === TERRAIN.water);
    const line: Draft = { mode: 'line', armyId: 3, points: [] };
    expect(draftTap(map, view, line, water).draft).toBe(line);
    expect(draftTap(map, view, line, enemyHex).draft).toBe(line);
    const off: Draft = { mode: 'offensive', armyId: 3, points: [] };
    expect(draftTap(map, view, off, water).draft).toBe(off);
    expect(draftTap(map, view, off, enemyHex).draft?.points).toEqual([enemyHex]);
  });

  it('подсветка линии обороны — цепочка соседних своих гексов от точки до точки', () => {
    const path = draftPath(map, view, { mode: 'line', armyId: 3, points: [a, b] });
    expect(path[0]).toBe(a);
    expect(path.at(-1)).toBe(b);
    for (let i = 1; i < path.length; i += 1) {
      const p = hexFromId(path[i - 1] as number, map.width);
      expect(distance(p, hexFromId(path[i] as number, map.width))).toBe(1);
      expect(view.hexes.owner[path[i] as number]).toBe(view.playerId);
    }
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
