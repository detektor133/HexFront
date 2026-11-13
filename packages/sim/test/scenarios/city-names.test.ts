import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { botName, cleanCityPool, pickCityName } from '../../src/map/city-names.ts';
import { at, city, own, scenario } from '../scenario/dsl.ts';

const MAP = `
  A1 a  a  b  B1
  a  a  a  b  b
`;
const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
};

describe('названия городов', () => {
  it('столицы получают разные названия при создании матча', () => {
    const s = scenario(MAP, { legend });
    const names = s.state.cities.map((c) => c.name);
    expect(names.every((n) => n !== '')).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('свой город переименовывается, чужой и пустое название отклоняются', () => {
    const s = scenario(MAP, { legend });
    const mine = s.cityAt(at(0, 0));
    const theirs = s.cityAt(at(4, 0));
    if (!mine || !theirs) throw new Error('нет городов');
    const before = theirs.name;
    applyCommands(s.state, [
      { playerId: 0, cmd: { t: 'renameCity', cityId: mine.id, name: '  Новая Заря ' } },
      { playerId: 0, cmd: { t: 'renameCity', cityId: theirs.id, name: 'Чужой' } },
      { playerId: 0, cmd: { t: 'renameCity', cityId: mine.id, name: '   ' } },
    ]);
    expect(s.cityAt(at(0, 0))?.name).toBe('Новая Заря');
    expect(s.cityAt(at(4, 0))?.name).toBe(before);
  });

  it('выбор названия пропускает занятые и детерминирован', () => {
    const s = scenario(MAP, { legend });
    const first = pickCityName(5, 11, s.state.cities);
    expect(pickCityName(5, 11, s.state.cities)).toBe(first);
    const taken = s.state.cities.map((c) => ({ ...c, name: first }));
    expect(pickCityName(5, 11, taken)).not.toBe(first);
  });
});

describe('слоговые названия и свой список', () => {
  it('названия латиницей, одинаковы для всех, боты подчёркнуты', () => {
    const a = botName(11, 3);
    expect(botName(11, 3)).toBe(a);
    expect(a).toContain('\u0332');
    expect(a.replace(/\u0332/gu, '')).toMatch(/^[A-Za-z]+$/u);
    for (let id = 0; id < 40; id += 1) {
      expect(pickCityName(9, id, [], id % 7)).toMatch(/^[A-Za-z ]+$/u);
    }
  });

  it('названия бота не повторяются, если передать занятые', () => {
    const names: string[] = [];
    for (let id = 0; id < 20; id += 1) names.push(botName(5, id, names));
    expect(new Set(names).size).toBe(names.length);
  });

  it('свой список идёт первым и по порядку, потом слоговые', () => {
    const pool = ['Aldoria', 'Brenn'];
    const first = pickCityName(1, 1, [], 0, pool);
    expect(first).toBe('Aldoria');
    const taken = [{ name: 'Aldoria' }] as never;
    expect(pickCityName(1, 2, taken, 0, pool)).toBe('Brenn');
    const both = [{ name: 'Aldoria' }, { name: 'Brenn' }] as never;
    expect(pickCityName(1, 3, both, 0, pool)).not.toMatch(/^(Aldoria|Brenn)$/u);
  });

  it('список игрока очищается: пробелы, повторы, предел', () => {
    expect(cleanCityPool(['  A  ', 'A', '', 'B  c'])).toEqual(['A', 'B c']);
    expect(cleanCityPool(Array.from({ length: 50 }, (_, i) => `n${i}`))).toHaveLength(30);
  });
});
