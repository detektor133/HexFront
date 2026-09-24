import { describe, expect, it } from 'vitest';

import { TICKS_PER_S } from '../../src/balance.ts';
import { TERRAIN } from '../../src/map/types.ts';
import type { Fp } from '../../src/math/int.ts';
import { findRoadPath } from '../../src/queries/road-path.ts';
import { mainNetworkMask } from '../../src/state/network.ts';
import { ROAD_TICKS_PER_HEX } from '../../src/systems/road-construction.ts';
import { at, city, foundCity, own, scenario, type At } from '../scenario/dsl.ts';

type S = ReturnType<typeof scenario>;

const idOf = (s: S, w: At): number => w.col + w.row * s.state.map.width;

function prepare(s: S): S {
  s.player('A').gold = (10_000 * 1000) as Fp;
  return s;
}

/** Основывает город и ждёт его появления (30 с). */
function found(s: S, where: At): void {
  s.setPop(where, 60);
  s.cmd('A', foundCity(where));
  s.runSeconds(30);
  expect(s.cityAt(where)).toBeDefined();
}

function roadJob(s: S) {
  return s.state.constructions.find((c) => c.kind === 'road');
}

describe('авто-дорога после основания города', () => {
  const OPEN = `
    a  a  a  a  a  a  a  a  a
    a  A1 a  a  a  a  a  a  a
    a  a  a  a  a  a  a  a  a
    .  .  .  .  .  .  .  .  .
  `;
  const legend = { A1: city('A', 1, { capital: true }), a: own('A') };

  it('прокладывается по гексу за 1,5 с и связывает город со столицей', () => {
    const s = prepare(scenario(OPEN, { legend }));
    const site = at(6, 1);
    found(s, site);
    const job = roadJob(s);
    expect(job?.path?.length).toBeGreaterThan(0);
    const length = job?.path?.length ?? 0;
    expect(ROAD_TICKS_PER_HEX).toBe(1.5 * TICKS_PER_S);
    s.runTicks(ROAD_TICKS_PER_HEX);
    expect(s.state.hexes.road[job?.path?.[0] ?? -1]).toBe(1);
    s.runTicks((length - 1) * ROAD_TICKS_PER_HEX);
    expect(roadJob(s)).toBeUndefined();
    expect(mainNetworkMask(s.state, 0)[idOf(s, site)]).toBe(1);
  });

  it('обходит горы: дорога не проходит по горам без перевала', () => {
    const WALL = `
      a  a  a  a  m  a  a  a  a
      a  A1 a  a  m  a  a  a  a
      a  a  a  a  m  a  a  a  a
      a  a  a  a  a  a  a  a  a
    `;
    const s = prepare(scenario(WALL, { legend: { ...legend, m: own('A', 'mountains') } }));
    const site = at(7, 1);
    found(s, site);
    s.runSeconds(60);
    expect(mainNetworkMask(s.state, 0)[idOf(s, site)]).toBe(1);
    s.state.map.terrain.forEach((t, id) => {
      if (t === TERRAIN.mountains) expect(s.state.hexes.road[id]).toBe(0);
    });
  });

  it('нет пути по своей земле — город остаётся без дороги', () => {
    const SPLIT = `
      a  a  a  a  .  a  a  a  a
      a  A1 a  a  .  a  a  a  a
      a  a  a  a  .  a  a  a  a
    `;
    const s = prepare(scenario(SPLIT, { legend }));
    found(s, at(7, 1));
    expect(roadJob(s)).toBeUndefined();
  });

  it('потеря гекса пути отменяет прокладку, построенное остаётся', () => {
    const s = prepare(scenario(OPEN, { legend }));
    found(s, at(6, 1));
    const path = roadJob(s)?.path ?? [];
    s.runTicks(ROAD_TICKS_PER_HEX);
    const last = path.at(-1) ?? -1;
    s.state.hexes.owner[last] = -1;
    s.runTicks(1);
    expect(roadJob(s)).toBeUndefined();
    expect(s.lastEvent('constructionCancelled')).toMatchObject({ kind: 'road' });
    expect(s.state.hexes.road[path[0] ?? -1]).toBe(1);
    expect(s.state.hexes.road[last]).toBe(0);
  });

  it('ведёт к городу основной сети, а не к ближайшему изолированному', () => {
    const TWO = `
      a  a  a  a  a  a  a  a  a  a  a  a  a
      a  A1 a  a  a  a  A2 a  a  a  a  a  a
      a  a  a  a  a  a  a  a  a  a  a  a  a
    `;
    const s = prepare(scenario(TWO, { legend: { ...legend, A2: city('A', 1) } }));
    const site = at(10, 1);
    found(s, site);
    s.runSeconds(60);
    expect(mainNetworkMask(s.state, 0)[idOf(s, site)]).toBe(1);
  });
});

describe('findRoadPath', () => {
  it('детерминирован и возвращает цепочку соседей от старта до цели', () => {
    const s = scenario(
      `
      a  a  a  a  a
      a  A1 a  a  a
      a  a  a  a  a
    `,
      { legend: { A1: city('A', 1, { capital: true }), a: own('A') } },
    );
    const from = idOf(s, at(4, 2));
    const target = idOf(s, at(1, 1));
    const a = findRoadPath(s.state, 0, from, (h) => h === target);
    const b = findRoadPath(s.state, 0, from, (h) => h === target);
    expect(a).toEqual(b);
    expect(a?.[0]).toBe(from);
    expect(a?.at(-1)).toBe(target);
  });
});
