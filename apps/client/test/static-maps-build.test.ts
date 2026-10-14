import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { mapUrl } from '../src/local/map-request.ts';
import { QUICK_MATCH_SEEDS, quickMatchUrl } from '../src/routes.ts';

const DIST_MAPS_DIR = new URL('../dist/maps/', import.meta.url);
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['--filter', '@hexfront/client', 'build'],
  {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  },
);

describe('статические карты gen для сборки клиента', () => {
  it('quickMatchUrl выдаёт только сиды из набора из 20 сидов', () => {
    expect(QUICK_MATCH_SEEDS).toHaveLength(20);

    const random = vi.spyOn(Math, 'random');

    try {
      for (let index = 0; index < QUICK_MATCH_SEEDS.length; index += 1) {
        random.mockReturnValue((index + 0.5) / QUICK_MATCH_SEEDS.length);
        const url = new URL(`http://localhost${quickMatchUrl()}`);
        const seed = Number(url.searchParams.get('seed'));

        expect(QUICK_MATCH_SEEDS).toContain(seed);
        expect(url.searchParams.get('map')).toBe('gen');
        expect(url.searchParams.get('players')).toBe('30');
      }
    } finally {
      random.mockRestore();
    }
  });

  it('сборка создаёт 20 файлов gen-<сид>-30.json, и каждый проходит loadMap', () => {
    const mapDirectoryExists = existsSync(DIST_MAPS_DIR);
    expect(mapDirectoryExists).toBe(true);

    const files = readdirSync(DIST_MAPS_DIR).filter((file) => /^gen-.+-30\.json$/.test(file));
    const expectedFiles = QUICK_MATCH_SEEDS.map((seed) => `gen-${seed}-30.json`);
    expect(files.sort()).toEqual(expectedFiles.sort());

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
