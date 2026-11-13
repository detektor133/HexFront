import { describe, expect, it } from 'vitest';

import { botName, pickCityName } from '@hexfront/sim';

import { isBotName, localName, NAME_TABLES_OK, territoryName } from './names.ts';

describe('названия государств и городов', () => {
  it('таблицы слов совпадают по размеру с кодами симуляции', () => {
    expect(NAME_TABLES_OK).toBe(true);
  });

  it('код бота — государство, на карте с подчёркиванием, в списках без него', () => {
    const raw = botName(1, 2);
    expect(isBotName(raw)).toBe(true);
    expect(localName(raw)).not.toMatch(/^~/);
    expect(territoryName(raw)).toBe(`${localName(raw)}_`);
  });

  it('введённое игроком название остаётся как есть', () => {
    expect(localName('Новая Заря')).toBe('Новая Заря');
  });

  it('любой код города читается словом', () => {
    for (let id = 0; id < 40; id += 1) {
      expect(localName(pickCityName(7, id, [], null))).not.toMatch(/^~/);
      expect(localName(pickCityName(7, id, [], id % 5))).not.toMatch(/^~/);
    }
  });
});
