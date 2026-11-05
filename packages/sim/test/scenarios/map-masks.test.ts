import { describe, expect, it } from 'vitest';

import { BUILD_NO, BUILD_NO_GOLD, BUILD_OK, buildMask } from '../../src/queries/map-masks.ts';
import { supplyLevels } from '../../src/state/supply.ts';
import { at, city, own, road, scenario, type At } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  r  a  .  B1
  a  a  a  a  a  .  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  r: road('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};
const idOf = (s: ReturnType<typeof scenario>, w: At): number => w.col + w.row * s.state.map.width;

describe('маска «где можно строить»', () => {
  it('своя пустая земля — можно, чужая и ничья — нельзя; без золота — отдельное значение', () => {
    const s = scenario(MAP, { legend });
    const mine = idOf(s, at(2, 0));
    expect(buildMask(s.state, s.player('A').id, 'fort')[mine]).toBe(BUILD_OK);
    expect(buildMask(s.state, s.player('A').id, 'fort')[idOf(s, at(6, 1))]).toBe(BUILD_NO);
    s.player('A').gold = 0 as never;
    expect(buildMask(s.state, s.player('A').id, 'fort')[mine]).toBe(BUILD_NO_GOLD);
  });

  it('укрепление не ставится в городе', () => {
    const s = scenario(MAP, { legend });
    expect(buildMask(s.state, s.player('A').id, 'fort')[idOf(s, at(0, 0))]).toBe(BUILD_NO);
  });
});

describe('маска снабжения', () => {
  it('чужой гекс — 0, свой — от 1 (0 %) до 101 (100 %), в городе сети — полное', () => {
    const s = scenario(MAP, { legend });
    const levels = supplyLevels(s.state, s.player('A').id);
    expect(levels[idOf(s, at(6, 1))]).toBe(0);
    expect(levels[idOf(s, at(0, 0))]).toBeGreaterThan(1);
    expect(levels[idOf(s, at(4, 1))]).toBeLessThanOrEqual(101);
  });
});
