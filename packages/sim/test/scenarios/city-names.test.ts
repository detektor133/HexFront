import { describe, expect, it } from 'vitest';

import { applyCommands } from '../../src/commands/apply.ts';
import { pickCityName } from '../../src/map/city-names.ts';
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
