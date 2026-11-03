import { describe, expect, it } from 'vitest';

import { validateUnitCommand } from '../../src/commands/unit.ts';
import { at, city, own, raw, scenario } from '../scenario/dsl.ts';

const LINE = `
  a  a  a  a  a  a  a  a
  A1 a  a  a  a  a  a  a
  a  a  a  a  a  a  a  a
`;
const legend = { A1: city('A', 1, { capital: true }), a: own('A') };
const make = () => scenario(LINE, { legend });
const id = (s: ReturnType<typeof make>, col: number, row: number): number =>
  col + row * s.state.map.width;

describe('приказ move с промежуточными точками', () => {
  it('проходит точки по порядку, без via ведёт себя как раньше', () => {
    const s = make();
    const unit = s.unit('A', 'infantry', 100, at(0, 1));
    const via = [id(s, 3, 0), id(s, 5, 2)];
    s.cmd('A', raw({ t: 'move', unitIds: [unit], to: id(s, 7, 1), via }));
    const visited: number[] = [];
    for (let t = 0; t < 2000; t += 1) {
      s.runTicks(1);
      const hex = s.unitById(unit)?.hex;
      if (hex !== undefined && visited.at(-1) !== hex) visited.push(hex);
    }

    expect(visited.indexOf(via[0] as number)).toBeGreaterThan(0);
    expect(visited.indexOf(via[1] as number)).toBeGreaterThan(visited.indexOf(via[0] as number));
    expect(visited.at(-1)).toBe(id(s, 7, 1));

    const plain = make();
    const walker = plain.unit('A', 'infantry', 100, at(0, 1));
    plain.cmd('A', raw({ t: 'move', unitIds: [walker], to: id(plain, 7, 1) }));
    plain.runTicks(1);
    expect(plain.unitById(walker)?.path.length).toBe(7);
  });

  it('отказывает за пределами карты, при лишних точках и недостижимом звене', () => {
    const s = make();
    const unit = s.unit('A', 'infantry', 100, at(0, 1));
    const reject = (to: number, via: number[]) => {
      const r = validateUnitCommand(s.state, 0, { t: 'move', unitIds: [unit], to, via });
      return r.ok ? 'ok' : r.reason;
    };
    expect(reject(id(s, 7, 1), [9999])).toBe('badHex');
    expect(reject(id(s, 7, 1), [1, 2, 3, 4, 5, 6])).toBe('badOrder');
    s.state.map.terrain.fill(0);
    expect(reject(id(s, 7, 1), [id(s, 3, 0)])).toBe('noPath');
  });

  it('другой приказ отменяет остаток маршрута', () => {
    const s = make();
    const unit = s.unit('A', 'infantry', 100, at(0, 1));
    s.cmd('A', raw({ t: 'move', unitIds: [unit], to: id(s, 7, 1), via: [id(s, 3, 0)] }));
    s.runTicks(3);
    s.cmd('A', raw({ t: 'stop', unitIds: [unit] }));
    s.runTicks(1);

    expect(s.unitById(unit)).toMatchObject({ order: 'idle', path: [] });
  });
});
