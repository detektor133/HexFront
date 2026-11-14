import { describe, expect, it } from 'vitest';

import { captureHex } from '../../src/state/capture.ts';
import { city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  ~  ~  b  B1
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('вода никому не принадлежит', () => {
  it('captureHex не отдаёт водный гекс, сушу отдаёт', () => {
    const s = scenario(MAP, { legend });
    captureHex(s.state, 2, 0);
    captureHex(s.state, 3, 1);
    expect(s.state.hexes.owner[2]).toBe(-1);
    expect(s.state.hexes.owner[3]).toBe(-1);
    captureHex(s.state, 4, 0);
    expect(s.state.hexes.owner[4]).toBe(0);
  });
});
