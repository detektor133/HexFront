import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  distance,
  FP,
  hexFromId,
  loadMap,
  TERRAIN,
  type Fp,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import { armySelection, selectHex } from '../src/dev/sandbox-selection.ts';
import { chipGroups } from '../src/dev/unit-groups.ts';
import { createLocalEngine } from '../src/local/engine.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const MAP: MapStatic = loaded.map;

type Engine = Exclude<ReturnType<typeof createLocalEngine>, { readonly errors: readonly string[] }>;

// pretick — первый тик до теста; без него ручное действие теста попадает в тот же тик, что первое
// решение commander, и побеждает (стартовая армия с auto ещё стоит).
function start(pretick = true): { e: Engine; view: () => PlayerView } {
  const e = createLocalEngine(small, 42, 2);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  let last: PlayerView | null = null;
  const tick = (): PlayerView => {
    const m = e.tick();
    if (m.t === 'view') last = m.view;
    if (!last) throw new Error('нет снимка');
    return last;
  };
  if (pretick) tick();
  return { e, view: tick };
}

// Своя равнина на расстоянии 5–7 от гекса: цель марша.
function farPlain(v: PlayerView, from: number): number {
  const { width } = MAP;
  const at = hexFromId(from, width);
  const h = v.hexes.owner.findIndex((_, id) => {
    const d = distance(hexFromId(id, width), at);
    return d >= 5 && d <= 7 && MAP.terrain[id] === TERRAIN.plains;
  });
  if (h < 0) throw new Error('нет цели');
  return h;
}

describe('группы движения (04/T15)', () => {
  it('стопка из 3 отрядов на марше — одна фишка с «3» на каждом снимке пути', () => {
    const { e, view } = start(false);
    const [a, b] = e.state.units.filter((u) => u.owner === 0);
    if (!a || !b) throw new Error('нет стартовых отрядов');
    e.queue({ t: 'split', unitId: a.id, soldiers: (50 * FP) as Fp });
    let v = view();
    const mine = v.units.filter((u) => u.owner === v.playerId && u.hex === a.hex);
    expect(mine).toHaveLength(3);
    const ids = mine.map((u) => u.id);
    const to = farPlain(v, a.hex);
    e.queue({ t: 'move', unitIds: ids, to });
    let moving = 0;
    for (let t = 0; t < 600; t += 1) {
      v = view();
      const march = v.units.filter((u) => ids.includes(u.id));
      if (march.every((u) => u.hex === to && u.path.length === 0)) break;
      if (march.some((u) => u.moveTotal > 0)) moving += 1;
      const groups = chipGroups(v).filter((g) => g.units.some((u) => ids.includes(u.id)));
      expect(groups, `тик ${t}`).toHaveLength(1);
      expect(groups[0]?.units.map((u) => u.id).sort()).toEqual([...ids].sort());
    }
    expect(moving).toBeGreaterThan(10);
  });

  it('разошедшиеся отряды — разные фишки', () => {
    const { e, view } = start();
    let v = view();
    const [a, b] = v.units.filter((u) => u.owner === v.playerId);
    if (!a || !b) throw new Error('нет стартовых отрядов');
    const to = farPlain(v, a.hex);
    e.queue({ t: 'move', unitIds: [a.id], to });
    v = view();
    v = view();
    const groups = chipGroups(v).filter((g) => g.units.some((u) => u.id === a.id || u.id === b.id));
    expect(groups).toHaveLength(2);
  });
});

describe('что выбрано (04/T15)', () => {
  const { view } = start();
  const v = view();
  const mine = v.units.filter((u) => u.owner === v.playerId);
  const home = (mine[0]?.hex ?? 0) as number;
  const empty = v.hexes.owner.findIndex(
    (_, id) => id !== home && !v.units.some((u) => u.hex === id),
  );

  it('тап по гексу со своими отрядами выбирает отряды, гекс не подсвечен', () => {
    const p = selectHex(v, { hex: null, units: [], target: null }, home);
    expect(p.hex).toBeNull();
    expect(p.units.length).toBeGreaterThan(0);
  });

  it('выбор гекса снимает выбор отрядов и наоборот', () => {
    const units = selectHex(v, { hex: null, units: [], target: null }, home);
    const hex = selectHex(v, units, empty);
    expect(hex).toMatchObject({ hex: empty, units: [] });
    // Повторный тап по тем же отрядам — карточка их гекса, отряды не выбраны.
    expect(selectHex(v, units, home)).toMatchObject({ hex: home, units: [] });
    expect(selectHex(v, hex, home).hex).toBeNull();
  });

  it('выбраны все отряды армии — армия выбрана; часть — армия не выбрана, тонкая рамка', () => {
    const army = v.armies.find((a) => mine.some((u) => u.armyId === a.id));
    if (!army) throw new Error('нет армии');
    const all = mine.filter((u) => u.armyId === army.id).map((u) => u.id);
    expect(all.length).toBeGreaterThan(1);
    expect(armySelection(v, all)).toEqual({ whole: army.id, partial: [] });
    expect(armySelection(v, all.slice(1))).toEqual({ whole: null, partial: [army.id] });
    expect(armySelection(v, [])).toEqual({ whole: null, partial: [] });
  });
});
