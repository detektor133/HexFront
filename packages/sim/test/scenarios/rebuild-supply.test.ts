import { describe, expect, it } from 'vitest';

import { NETWORK_RECALC_TICKS, SUPPLY_REBUILD_COST_PER_HEX } from '../../src/balance.ts';
import type { Fp } from '../../src/math/int.ts';
import { hashState } from '../../src/state/hash.ts';
import { isCityIsolated } from '../../src/state/network.ts';
import { ROAD_TICKS_PER_HEX } from '../../src/systems/road-construction.ts';
import { at, city, own, rebuildSupply, road, scenario, type At } from '../scenario/dsl.ts';

// Столица A1 связана с A2 дорогой по строке 1; строки 0 и 2 — своя земля для обхода.
const MAP = `
  a  a  a  a  a  a  a  a  a
  a  A1 r  r  r  r  A2 a  a
  a  a  a  a  a  a  a  a  a
`;
const legend = { A1: city('A', 1, { capital: true }), A2: city('A', 1), a: own('A'), r: road('A') };
const A2 = at(6, 1);
const CUT = at(4, 1);

type S = ReturnType<typeof scenario>;

/** Разрезает дорогу нейтральным гексом и ждёт пересчёта сетей. */
function isolate(s: S): void {
  s.player('A').gold = (1000 * 1000) as Fp;
  s.player('A').taxEffective = 0 as Fp;
  s.player('A').taxTarget = 0 as Fp;
  s.setOwner(CUT, null);
  s.runTicks(NETWORK_RECALC_TICKS);
}

const isolated = (s: S, where: At): boolean => isCityIsolated(s.state, s.cityAt(where)?.id ?? -1);
const job = (s: S) => s.state.constructions.find((c) => c.kind === 'road');

describe('перестройка снабжения', () => {
  it('город в основной сети — отказ notIsolated', () => {
    const s = scenario(MAP, { legend });
    s.runTicks(1);
    s.cmd('A', rebuildSupply(A2));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notIsolated']);
  });

  it('изолированный город: путь в обход, цена 15 × гексов без дороги, связь восстанавливается', () => {
    const s = scenario(MAP, { legend });
    isolate(s);
    expect(isolated(s, A2)).toBe(true);
    const before = s.player('A').gold;
    s.cmd('A', rebuildSupply(A2));
    s.runTicks(1);
    expect(s.rejections()).toEqual([]);
    const toBuild = job(s)?.path?.length ?? 0;
    expect(toBuild).toBeGreaterThan(0);
    // За тик город-столица и изолированный A2 принесли 0,05 + 0,025 золота.
    expect(before - s.player('A').gold).toBe(SUPPLY_REBUILD_COST_PER_HEX * toBuild - 75);
    s.runTicks(toBuild * ROAD_TICKS_PER_HEX + NETWORK_RECALC_TICKS);
    expect(job(s)).toBeUndefined();
    expect(isolated(s, A2)).toBe(false);
  });

  it('путь по уже проложенной дороге не оплачивается', () => {
    // Обход по строке 2 уже частично замощён.
    const PARTIAL = `
      a  a  a  a  a  a  a  a  a
      a  A1 r  r  r  r  A2 a  a
      a  a  r  r  r  r  a  a  a
    `;
    const s = scenario(PARTIAL, { legend });
    isolate(s);
    s.cmd('A', rebuildSupply(A2));
    s.runTicks(1);
    const path = job(s)?.path ?? [];
    for (const hex of path) expect(s.state.hexes.road[hex]).toBe(0);
  });

  it('нет пути по своей земле — отказ noPath («город окружён»)', () => {
    const RING = `
      a  a  a  .  .  .  .
      a  A1 r  .  A2 a  .
      a  a  a  .  .  .  .
    `;
    // A2 отрезан нейтральной землёй изначально, резать дорогу не нужно.
    const s = scenario(RING, { legend });
    s.player('A').gold = (1000 * 1000) as Fp;
    s.runTicks(NETWORK_RECALC_TICKS);
    s.cmd('A', rebuildSupply(at(4, 1)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['noPath']);
  });

  it('не хватает золота — отказ, состояние не меняется', () => {
    const a = scenario(MAP, { legend });
    const b = scenario(MAP, { legend });
    for (const s of [a, b]) {
      isolate(s);
      s.player('A').gold = 0 as Fp;
    }
    a.cmd('A', rebuildSupply(A2));
    a.runTicks(1);
    b.runTicks(1);
    expect(a.rejections()).toEqual(['notEnoughGold']);
    expect(hashState(a.state)).toBe(hashState(b.state));
  });

  it('повторная команда во время прокладки — отказ alreadyBuilding', () => {
    const s = scenario(MAP, { legend });
    isolate(s);
    s.cmd('A', rebuildSupply(A2));
    s.runTicks(1);
    s.cmd('A', rebuildSupply(A2));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['alreadyBuilding']);
  });

  it('захват гекса пути отменяет прокладку, золото не возвращается', () => {
    const s = scenario(MAP, { legend });
    isolate(s);
    s.cmd('A', rebuildSupply(A2));
    s.runTicks(1);
    const path = job(s)?.path ?? [];
    const gold = s.player('A').gold;
    const last = path.at(-1) ?? -1;
    s.state.hexes.owner[last] = -1;
    s.runTicks(1);
    expect(job(s)).toBeUndefined();
    expect(s.player('A').gold).toBeLessThan(gold + 1000);
    expect(s.lastEvent('constructionCancelled')).toMatchObject({ kind: 'road' });
  });

  it('чужой или несуществующий город — отказ', () => {
    const s = scenario(MAP, { legend });
    s.cmd('A', rebuildSupply(at(0, 0)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['unknownCity']);
  });
});
