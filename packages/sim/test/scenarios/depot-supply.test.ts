import { describe, expect, it } from 'vitest';

import type { Fp } from '../../src/math/int.ts';
import { BUILDING } from '../../src/state/types.ts';
import { at, build, city, own, scenario } from '../scenario/dsl.ts';

// Полоса суши: столица слева, склад ставится в 6 гексах от неё.
const MAP = `
  A1 a  a  a  a  a  a  a  a
`;
const legend = { A1: city('A', 1, { capital: true }), a: own('A') };
const gold = (n: number): Fp => (n * 1000) as Fp;

function game() {
  const s = scenario(MAP, { legend });
  s.player('A').gold = gold(2000);
  s.player('A').taxEffective = 0 as Fp;
  s.player('A').taxTarget = 0 as Fp;
  return s;
}
const idOf = (s: ReturnType<typeof game>, col: number): number =>
  col + at(col, 0).row * s.state.map.width;

describe('склад — узел снабжения', () => {
  it('построенный склад сам просит дорогу и входит в основную сеть', () => {
    const s = game();
    s.cmd('A', build(at(6, 0), 'depot'));
    s.runSeconds(15);
    expect(s.state.hexes.building[idOf(s, 6)]).toBe(BUILDING.depot);
    // Дорога тянется от склада к сети по 1,5 с на гекс: через минуту сеть сомкнулась.
    s.runSeconds(60);
    expect(s.state.hexes.network[idOf(s, 6)]).toBe(s.state.hexes.network[idOf(s, 0)]);
    expect(s.state.hexes.road[idOf(s, 3)]).toBe(1);
  });

  it('склад повышает снабжение армии: больше солдат кормится', () => {
    const s = game();
    // 2000 солдат пехоты у столицы: столица даёт 500 — снабжение 25 %.
    const unit = s.unit('A', 'infantry', 2000, at(1, 0));
    s.runSeconds(2);
    const before = s.unitById(unit)?.supplyLevel ?? 0;
    s.cmd('A', build(at(6, 0), 'depot'));
    s.runSeconds(80);
    const after = s.unitById(unit)?.supplyLevel ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  it('склад улучшается до третьего уровня и производит больше снабжения', () => {
    const s = game();
    s.cmd('A', build(at(6, 0), 'depot'));
    s.runSeconds(15);
    s.cmd('A', build(at(6, 0), 'depot'));
    s.runSeconds(21);
    expect(s.state.hexes.building[idOf(s, 6)]).toBe(BUILDING.depot2);
    s.cmd('A', build(at(6, 0), 'depot'));
    s.runSeconds(31);
    expect(s.state.hexes.building[idOf(s, 6)]).toBe(BUILDING.depot3);
    s.cmd('A', build(at(6, 0), 'depot'));
    s.runTicks(1);
    expect(s.rejections()).toEqual(['maxLevel']);
  });
});
