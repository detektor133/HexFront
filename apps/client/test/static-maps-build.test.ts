import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { mapUrl } from '../src/local/map-request.ts';
import { QUICK_MATCH_SEEDS, quickMatchUrl } from '../src/routes.ts';

const DIST_MAPS_DIR = new URL('../dist/maps/', import.meta.url);

describe('статические карты gen для сборки клиента', () => {
  it('quickMatchUrl выдаёт только сиды из набора из 20 сидов', () => {
    expect(QUICK_MATCH_SEEDS).toHaveLength(20);

    const url = new URL(`http://localhost${quickMatchUrl()}`);
    const seed = Number(url.searchParams.get('seed'));

    expect(QUICK_MATCH_SEEDS).toContain(seed);
    expect(url.searchParams.get('map')).toBe('gen');
    expect(url.searchParams.get('players')).toBe('30');
  });

  it('в dist/maps находятся 20 файлов gen-<сид>-30.json, и каждый проходит loadMap', () => {
    const mapDirectoryExists = existsSync(DIST_MAPS_DIR);
    expect(mapDirectoryExists).toBe(true);
    if (!mapDirectoryExists) return;

    const files = readdirSync(DIST_MAPS_DIR).filter((file) => /^gen-.+-30\.json$/.test(file));
    expect(files).toHaveLength(20);

    for (const file of files) {
      const map = JSON.parse(readFileSync(new URL(file, DIST_MAPS_DIR), 'utf8')) as unknown;
      expect(loadMap(map).ok, file).toBe(true);
    }
  });

  it('mapUrl для сида из набора возвращает статический путь карты', () => {
    const quickMatch = new URL(`http://localhost${quickMatchUrl()}`);
    const seed = Number(quickMatch.searchParams.get('seed'));

    expect(mapUrl({ id: 'gen', seed, players: 30 })).toBe(`/maps/gen-${seed}-30.json`);
  });

  it('клиент не импортирует mapgen напрямую', () => {
    const sourceFiles = ['../src/routes.ts', '../src/local/map-request.ts'];

    for (const sourceFile of sourceFiles) {
      const source = readFileSync(new URL(sourceFile, import.meta.url), 'utf8');
      expect(source).not.toMatch(/(?:from|import)\s*['"][^'"]*mapgen[^'"]*['"]/);
    }
  });
});
