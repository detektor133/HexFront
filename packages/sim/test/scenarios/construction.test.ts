import { describe, expect, it } from 'vitest';

import { TICKS_PER_S } from '../../src/balance.ts';
import { distance, offsetToAxial } from '../../src/math/hex.ts';
import type { Fp } from '../../src/math/int.ts';
import { hashState } from '../../src/state/hash.ts';
import { BUILDING } from '../../src/state/types.ts';
import {
  at,
  build,
  city,
  foundCity,
  improve,
  own,
  scenario,
  upgradeCity,
  type At,
} from '../scenario/dsl.ts';

// Равнина: лимит гекса 100 чел., 60 % — 60 чел.
const MAP = `
  a  a  a  a  a  a  a  a  a
  a  A1 a  a  a  a  a  a  a
  a  a  a  a  a  a  a  a  a
  a  a  a  a  a  a  a  a  a
  a  a  a  a  a  a  a  a  a
  .  .  .  .  .  .  .  .  .
`;
const legend = { A1: city('A', 1, { capital: true }), a: own('A') };
const CAPITAL = at(1, 1);
const gold = (n: number): Fp => (n * 1000) as Fp;

function fresh(goldAmount = 1000): ReturnType<typeof scenario> {
  const s = scenario(MAP, { legend });
  s.player('A').gold = gold(goldAmount);
  // Налог 0: доход только от города, чтобы проверять списания точно.
  s.player('A').taxEffective = 0 as Fp;
  s.player('A').taxTarget = 0 as Fp;
  return s;
}

/** Первая своя клетка на дистанции d от столицы и не ближе minFrom к клеткам avoid. */
function cellAt(s: ReturnType<typeof scenario>, d: number, avoid: At[] = [], minFrom = 0): At {
  const { width, height } = s.state.map;
  const axial = (w: At) => offsetToAxial({ col: w.col, row: w.row });
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const w = at(col, row);
      if (s.owner(w) !== 'A' || distance(axial(w), axial(CAPITAL)) !== d) continue;
      if (avoid.every((a) => distance(axial(w), axial(a)) >= minFrom)) return w;
    }
  }
  throw new Error(`нет клетки на дистанции ${d}`);
}

describe('основание города', () => {
  it('дистанция 3 до города — отказ, 4 — стройка начата', () => {
    const s = fresh();
    const near = cellAt(s, 3);
    const far = cellAt(s, 4);
    s.setPop(near, 60);
    s.setPop(far, 60);
    s.cmd('A', foundCity(near));
    s.cmd('A', foundCity(far));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['cityTooClose']);
    expect(s.state.constructions).toHaveLength(1);
  });

  it('население 59 % лимита — отказ, 60 % — можно', () => {
    const s = fresh();
    const hex = cellAt(s, 5);
    s.setPop(hex, 59);
    s.cmd('A', foundCity(hex));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['popTooLow']);
    s.setPop(hex, 60);
    s.cmd('A', foundCity(hex));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['popTooLow']);
  });

  it('не хватает золота — отказ и состояние не меняется', () => {
    const a = fresh(119);
    const b = fresh(119);
    const hex = cellAt(a, 5);
    for (const s of [a, b]) s.setPop(hex, 60);
    a.cmd('A', foundCity(hex));
    a.runTicks(1);
    b.runTicks(1);
    expect(a.rejections()).toEqual(['notEnoughGold']);
    expect(hashState(a.state)).toBe(hashState(b.state));
  });

  it('цена растёт: 120 × (1 + 0,5 × N), N учитывает начатые основания', () => {
    const s = fresh(1000);
    const first = cellAt(s, 4);
    const second = cellAt(s, 7, [first], 4);
    s.setPop(first, 60);
    s.setPop(second, 60);
    const before = s.player('A').gold;
    s.cmd('A', foundCity(first));
    s.cmd('A', foundCity(second));
    s.runTicks(1);
    expect(s.rejections()).toEqual([]);
    // Списано 120 + 180; за тик город-столица принёс 0,05.
    expect(before - s.player('A').gold).toBe(gold(300) - 50);
  });

  it('город появляется через 30 с: уровень 1, владелец — игрок', () => {
    const s = fresh();
    const hex = cellAt(s, 5);
    s.setPop(hex, 60);
    s.cmd('A', foundCity(hex));
    s.runTicks(30 * TICKS_PER_S - 1);
    expect(s.cityAt(hex)).toBeUndefined();
    s.runTicks(1);
    expect(s.cityAt(hex)).toMatchObject({ owner: 0, level: 1 });
    // Стройка основания закрыта; вместо неё идёт авто-дорога к столице (02/T6).
    expect(s.state.constructions.map((c) => c.kind)).toEqual(['road']);
    expect(s.player('A').citiesFounded).toBe(1);
  });

  it('потеря гекса отменяет стройку без возврата золота', () => {
    const s = fresh();
    const hex = cellAt(s, 5);
    s.setPop(hex, 60);
    s.cmd('A', foundCity(hex));
    s.runSeconds(5);
    const goldBefore = s.player('A').gold;
    s.state.hexes.owner[hex.col + hex.row * s.state.map.width] = -1;
    s.runSeconds(30);
    expect(s.cityAt(hex)).toBeUndefined();
    expect(s.state.constructions).toHaveLength(0);
    expect(s.player('A').gold).toBeGreaterThan(goldBefore);
    expect(s.lastEvent('constructionCancelled')).toBeDefined();
  });

  it('чужой или нейтральный гекс — отказ', () => {
    const s = fresh();
    s.cmd('A', foundCity(at(4, 5)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['notOwnHex']);
  });

  it('на гексе уже идёт стройка — отказ', () => {
    const s = fresh();
    const hex = cellAt(s, 5);
    s.setPop(hex, 60);
    s.cmd('A', foundCity(hex));
    s.cmd('A', improve(hex));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['hexBusy']);
  });
});

describe('улучшение города', () => {
  it('уровень 2 стоит 100 и строится 20 с', () => {
    const s = fresh(150);
    s.cmd('A', upgradeCity(CAPITAL));
    s.runTicks(20 * TICKS_PER_S - 1);
    expect(s.cityAt(CAPITAL)?.level).toBe(1);
    s.runTicks(1);
    expect(s.cityAt(CAPITAL)?.level).toBe(2);
  });

  it('уровень 5 — предел', () => {
    const s = fresh();
    const capital = s.cityAt(CAPITAL);
    if (capital) capital.level = 5;
    s.cmd('A', upgradeCity(CAPITAL));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['maxLevel']);
  });

  it('несуществующий город — отказ', () => {
    const s = fresh();
    s.cmd('A', upgradeCity(at(4, 4)));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['unknownCity']);
  });
});

describe('благоустройство', () => {
  it('уровни 1–3: цена 20/40/80, время 5/8/12 с; дальше — предел', () => {
    const s = fresh();
    const hex = cellAt(s, 1);
    const id = hex.col + hex.row * s.state.map.width;
    for (const [seconds, level] of [
      [5, 1],
      [8, 2],
      [12, 3],
    ] as const) {
      s.cmd('A', improve(hex));
      s.runTicks(seconds * TICKS_PER_S);
      expect(s.state.hexes.improvement[id]).toBe(level);
    }
    s.cmd('A', improve(hex));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['maxLevel']);
  });

  it('в городе благоустройство недоступно', () => {
    const s = fresh();
    s.cmd('A', improve(CAPITAL));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['isCity']);
  });
});

describe('постройки', () => {
  it('укрепление: 60 золота, 10 с; не в городе', () => {
    const s = fresh();
    const hex = cellAt(s, 2);
    const id = hex.col + hex.row * s.state.map.width;
    s.cmd('A', build(hex, 'fort'));
    s.cmd('A', build(CAPITAL, 'fort'));
    s.runSeconds(10);
    expect(s.rejections()).toEqual(['fortInCity']);
    expect(s.state.hexes.building[id]).toBe(BUILDING.fort);
  });

  it('склад — только на дорожном гексе', () => {
    const s = fresh();
    const hex = cellAt(s, 2);
    const id = hex.col + hex.row * s.state.map.width;
    s.cmd('A', build(hex, 'depot'));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['depotNeedsRoad']);
    s.state.hexes.road[id] = 1;
    s.cmd('A', build(hex, 'depot'));
    s.runSeconds(15);
    expect(s.state.hexes.building[id]).toBe(BUILDING.depot);
  });

  it('одна постройка на гекс, благоустройство с ней совместимо', () => {
    const s = fresh();
    const hex = cellAt(s, 2);
    s.cmd('A', build(hex, 'fort'));
    s.runSeconds(10);
    s.cmd('A', build(hex, 'fort'));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['buildingExists']);
    s.cmd('A', improve(hex));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['buildingExists']);
  });
});
