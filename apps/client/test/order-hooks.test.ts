import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  edgeOf,
  hexFromId,
  loadMap,
  type MapStatic,
  type PlanView,
  type PlayerView,
} from '@hexfront/sim';

import type { OrderTarget } from '../src/dev/economy-layer.ts';
import { createOrderHooks } from '../src/dev/order-hooks.ts';
import { startDraft, tapCommand } from '../src/dev/plan-draft.ts';
import { edgeMid } from '../src/dev/plan-edges.ts';
import { selectHex, type Picked } from '../src/dev/sandbox-selection.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
const R = tokens.map.hexRadius;
const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const MAP: MapStatic = loaded.map;

function view(): PlayerView {
  const e = createLocalEngine(small, 42, 2);
  if ('errors' in e) throw new Error(e.errors.join('; '));
  const m = e.tick();
  if (m.t !== 'view') throw new Error('нет снимка');
  return m.view;
}

describe('приказ удержанием и прогноз при наведении (04/T16)', () => {
  const v = view();
  const mine = v.units.filter((u) => u.owner === v.playerId);
  const home = mine[0]?.hex ?? 0;
  const enemy = v.units.find((u) => u.owner !== v.playerId);
  if (!enemy) throw new Error('нет врага');
  const at = (hex: number) => hexCenter(hexFromId(hex, MAP.width), R);
  const free = v.hexes.owner.findIndex(
    (_, id) => id !== home && !v.units.some((u) => u.hex === id) && MAP.terrain[id] !== 0,
  );

  function setup(p: Picked, tool = false) {
    const targets: (OrderTarget | null)[] = [];
    const orders: number[] = [];
    const hooks = createOrderHooks({
      map: MAP,
      radius: R,
      view: () => v,
      picked: () => p,
      tool: () => tool,
      chipAt: (hex) => at(hex),
      setTarget: (t) => targets.push(t),
      order: (hex) => orders.push(hex),
    });
    return { hooks, targets, orders };
  }
  const picked = selectHex(v, { hex: null, units: [], target: null }, home);

  it('наведение на врага при выбранных отрядах — прогноз без слов; на свой гекс — ничего', () => {
    const s = setup(picked);
    s.hooks.hover(at(enemy.hex));
    const t = s.targets.at(-1);
    expect(t?.hex).toBe(enemy.hex);
    expect(t?.badge?.text).toMatch(/^−\d+\s%$/u);
    s.hooks.hover(at(free));
    expect(s.targets.at(-1)).toBeNull();
  });

  it('без выбранных отрядов или с инструментом наведение и удержание — не приказ', () => {
    const none = setup({ hex: null, units: [], target: null });
    expect(none.hooks.canHold()).toBe(false);
    none.hooks.hover(at(enemy.hex));
    expect(none.targets.filter((t) => t !== null)).toEqual([]);
    expect(setup(picked, true).hooks.canHold()).toBe(false);
    expect(setup(picked).hooks.canHold()).toBe(true);
  });

  it('удержание → ведение → отпускание: цель с прогнозом едет, приказ — в гекс под пальцем', () => {
    const s = setup(picked);
    s.hooks.hold(at(free), 'start');
    expect(s.targets.at(-1)).toEqual({ hex: free, badge: null });
    s.hooks.hold(at(enemy.hex), 'move');
    expect(s.targets.at(-1)?.badge).not.toBeNull();
    s.hooks.hold(at(enemy.hex), 'end');
    expect(s.targets.at(-1)).toBeNull();
    expect(s.orders).toEqual([enemy.hex]);
  });

  it('отмена удержания не отдаёт приказа; фишка выбранных отрядов — зона отмены', () => {
    const s = setup(picked);
    s.hooks.hold(at(enemy.hex), 'start');
    s.hooks.hold(at(enemy.hex), 'cancel');
    expect(s.orders).toEqual([]);
    expect(s.targets.at(-1)).toBeNull();
    expect(s.hooks.cancelZone(at(home))).toBe(true);
    expect(s.hooks.cancelZone(at(enemy.hex))).toBe(false);
  });
});

describe('«Удалить» (04/T16)', () => {
  const v = view();
  const c = { map: MAP, view: v, radius: R };
  const e0 = edgeOf(v.units.find((u) => u.owner === v.playerId)?.hex ?? 0, 0);
  const far = edgeOf((v.units.find((u) => u.owner === v.playerId)?.hex ?? 0) + 6, 0);
  const plan: PlanView = {
    armyId: 3,
    kind: 'front',
    edges: [e0],
    hexes: [],
    offensive: { edges: [far], hexes: [], active: false, progressTick: 0, taken: [] },
    zone: [],
    stuck: false,
    facing: [],
  };
  const withPlan = { ...v, plans: [plan] };
  const erase = startDraft('erase', 3);

  it('по фронту — убирает весь план (с наступлением), по линии наступления — только её', () => {
    expect(tapCommand({ ...c, view: withPlan }, erase, edgeMid(MAP, R, e0))).toEqual({
      t: 'clearPlan',
      armyId: 3,
    });
    expect(tapCommand({ ...c, view: withPlan }, erase, edgeMid(MAP, R, far))).toEqual({
      t: 'clearOffensive',
      armyId: 3,
    });
  });
});
