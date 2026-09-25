import { describe, expect, it } from 'vitest';

import { unitOf, at, attack, city, own, scenario } from '../scenario/dsl.ts';

const EXAMPLE = `
  .  .  .  .  .
  .  A1 a  .  .
  .  a  a  b  .
  .  .  b  B1 .
`;

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  b: own('B'),
  B1: city('B', 1, { capital: true }),
};

describe('сценарный DSL', () => {
  it('разбирает пример из testing.md в состояние матча', () => {
    const s = scenario(EXAMPLE, { legend });
    expect(s.state.map.width).toBe(5);
    expect(s.state.map.height).toBe(4);
    expect(s.owner(at(1, 1))).toBe('A');
    expect(s.owner(at(3, 2))).toBe('B');
    expect(s.owner(at(0, 0))).toBeNull();
    expect(s.state.cities.map((c) => c.name)).toEqual(['A1', 'B1']);
    expect(s.state.players.map((p) => p.capitalCityId)).toEqual([1, 2]);
  });

  it('выполняет пример целиком: отряды, команда атаки, прогон по времени', () => {
    const s = scenario(EXAMPLE, { legend });
    s.unit('A', 'infantry', 500, at(1, 2));
    s.unit('B', 'infantry', 200, at(2, 3));
    s.cmd('A', attack([unitOf('A')], at(2, 3)));
    s.runSeconds(60);

    expect(s.state.tick).toBe(600);
    expect(s.owner(at(2, 3))).toBe('A');
    expect(s.unitsOf('B')).toHaveLength(1); // отступил, а не исчез
    expect(s.lastEvent('unitRetreated')).toBeDefined();
  });

  it('сообщает о токене, которого нет в легенде', () => {
    expect(() => scenario('. x .', { legend: {} })).toThrow('токен «x»');
  });

  it('сообщает о строках разной длины', () => {
    expect(() => scenario('. .\n.', { legend: {} })).toThrow('разной длины');
  });
});
