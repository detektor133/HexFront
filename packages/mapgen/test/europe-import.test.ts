import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { decodeBase64, loadMap, TERRAIN } from '@hexfront/sim';

import { CITY_NAMES } from '../src/map.ts';

const MAP = new URL('../maps/europe.json', import.meta.url);

describe('импорт карты Европы', () => {
  it('сохраняет карту v1 с 30 спавнами и валидной сеткой', async () => {
    const json = JSON.parse(await readFile(MAP, 'utf8')) as Record<string, unknown>;
    const loaded = loadMap(json);
    expect(loaded.ok).toBe(true);
    expect(json.spawns).toHaveLength(30);
    expect(json.cities).not.toHaveLength(0);
    const terrain = decodeBase64(json.terrain as string);
    expect(terrain?.some((code) => code === TERRAIN.mountains)).toBe(true);
    expect(terrain?.some((code) => code === TERRAIN.hills)).toBe(true);
    expect(
      (json.cities as { name: string }[]).every((city) =>
        CITY_NAMES.includes(city.name.replace(/-\d+$/, '')),
      ),
    ).toBe(true);
  });

  it('скрипт импорта не хранит исходные Natural Earth в репозитории', async () => {
    const script = await readFile(new URL('../import/europe.ts', import.meta.url), 'utf8');
    expect(script).toContain('mkdtemp');
    expect(script).toContain('naciscdn.org/naturalearth/10m/physical');
    expect(script).toContain('EPSG:3035');
  });
});
