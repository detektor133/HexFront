import { describe, expect, it } from 'vitest';

import { hashState } from '../../src/state/hash.ts';
import { populationAnchorValue, populationAt } from '../../src/state/population.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  ~  ~  ~  ~  ~  ~
  A1 a  .  .  b  B1
  ~  ~  ~  ~  ~  ~
`;
const LEGEND = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('якоря населения', () => {
  it('запрос населения не меняет состояние', () => {
    const s = scenario(MAP, { legend: LEGEND });
    const before = hashState(s.state);
    const first = populationAt(s.state, 1);
    const second = populationAt(s.state, 1);
    expect(second).toBe(first);
    expect(hashState(s.state)).toBe(before);
    expect(populationAnchorValue(s.state, 1)).toBeGreaterThanOrEqual(0);
  });

  it('материализует захват нейтрального гекса без потери населения', () => {
    const s = scenario(MAP, { legend: LEGEND });
    s.setPop(at(2, 1), 20);
    const hex = 2 + s.state.map.width;
    const before = populationAt(s.state, hex);
    s.capture(at(2, 1), 'A');
    expect(populationAt(s.state, hex)).toBe(before);
    expect(s.state.hexes.populationAnchorM[hex]).toBe(s.state.populationM[0]);
  });

  it('материализует потерю населения при захвате вражеского гекса', () => {
    const s = scenario(MAP, { legend: LEGEND });
    s.setPop(at(4, 1), 50);
    s.capture(at(4, 1), 'A');
    const hex = 4 + s.state.map.width;
    expect(populationAt(s.state, hex)).toBe(40_000);
    expect(s.state.hexes.populationAnchor[hex]).toBeGreaterThan(0);
  });
});
