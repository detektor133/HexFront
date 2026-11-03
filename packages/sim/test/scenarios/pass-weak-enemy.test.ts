import { describe, expect, it } from 'vitest';

import { routePath } from '../../src/commands/unit.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  a  a  a  a  a  a  a
  A1 a  a  a  a  a  a
  a  a  a  a  a  a  B1
`;
const MAP_W = 7;
const legend = {
  A1: city('A', 1, { capital: true }),
  B1: city('B', 1, { capital: true }),
  a: own('A'),
};

// Путь по прямой через гекс (3,1): слабый враг не преграда, сильный — обходится.
function lineLength(enemySoldiers: number): { straight: boolean } {
  const s = scenario(MAP, { legend });
  const mover = s.unit('A', 'infantry', 100, at(1, 1));
  s.unit('B', 'infantry', enemySoldiers, at(3, 1));
  const unit = s.unitById(mover);
  if (!unit) throw new Error('нет отряда');
  const path = routePath(s.state, unit, [], 5 + MAP_W) ?? [];
  return { straight: path.includes(3 + MAP_W) };
}

describe('путь через слабых врагов', () => {
  it('слабый враг на пути — идём прямо (атакуем по дороге), сильный — обходим', () => {
    expect(lineLength(5).straight).toBe(true);
    expect(lineLength(400).straight).toBe(false);
  });
});
