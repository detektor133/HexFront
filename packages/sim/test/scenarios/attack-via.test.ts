import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { at, city, own, scenario, type At } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  a  a  a  .
  a  a  a  a  a  a  B1
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
};
const idOf = (s: ReturnType<typeof scenario>, w: At): number => w.col + w.row * s.state.map.width;

describe('цепочка приказов: атака через промежуточные точки', () => {
  it('attack с via строит путь через точки по порядку', () => {
    const s = scenario(MAP, { legend });
    const id = s.unit('A', 'infantry', 200, at(0, 1));
    const via = idOf(s, at(3, 0));
    const target = idOf(s, at(6, 1));
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'attack', unitIds: [id], target, via: [via] } },
    ]);
    const unit = s.unitById(id);
    expect(unit?.path.includes(via)).toBe(true);
    expect(unit?.path.at(-1)).toBe(target);
  });
});
