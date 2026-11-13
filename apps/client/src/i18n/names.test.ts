import { describe, expect, it } from 'vitest';

import { botName, pickCityName } from '@hexfront/sim';

import { isBotName, localName, NAME_TABLES_OK, territoryName, underlined } from './names.ts';

describe('названия государств и городов', () => {
  it('таблицы слов совпадают по размеру с кодами симуляции', () => {
    expect(NAME_TABLES_OK).toBe(true);
  });

  it('имя бота — государство с подчёркнутыми буквами везде одинаково', () => {
    const raw = botName(1, 2);
    expect(isBotName(raw)).toBe(true);
    expect(localName(raw)).not.toMatch(/^~/);
    expect(localName(raw)).toContain('̲');
    expect(territoryName(raw)).toBe(localName(raw));
    expect(underlined('ab')).toBe('a̲b̲');
  });

  it('введённое игроком название остаётся как есть, город без подчёркивания', () => {
    expect(localName('Новая Заря')).toBe('Новая Заря');
    expect(localName(pickCityName(7, 3, [], 0))).not.toContain('̲');
  });

  it('любой код города читается словом', () => {
    for (let id = 0; id < 60; id += 1) {
      expect(localName(pickCityName(7, id, [], null))).not.toMatch(/^~/);
      expect(localName(pickCityName(7, id, [], id % 5))).not.toMatch(/^~/);
    }
  });
});
