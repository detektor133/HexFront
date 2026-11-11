import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { QUICK_MATCH_SEEDS } from '@hexfront/protocol';
import { loadMap } from '@hexfront/sim';

import { quickMatchMap } from '../src/hub.ts';

const SCRIPT = fileURLToPath(
  new URL('../../../packages/mapgen/scripts/generate-json.ts', import.meta.url),
);

describe('карта комнаты совпадает с файлом карты клиента', () => {
  it.each([QUICK_MATCH_SEEDS[0], QUICK_MATCH_SEEDS[5], QUICK_MATCH_SEEDS.at(-1)])(
    'сид %i',
    (seed) => {
      // Клиент отдаёт карту, собранную этим скриптом (vite.config.ts): номера гексов должны совпасть.
      const json: unknown = JSON.parse(
        execFileSync(process.execPath, ['--experimental-strip-types', SCRIPT, String(seed), '30'], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      );
      const client = loadMap(json);
      if (!client.ok) throw new Error(client.errors.join('; '));
      const server = quickMatchMap(seed as number, 30);
      expect([server.width, server.height]).toEqual([client.map.width, client.map.height]);
      expect([...server.terrain]).toEqual([...client.map.terrain]);
      expect(server.spawns).toEqual(client.map.spawns);
      expect(server.cities).toEqual(client.map.cities);
    },
    60_000,
  );
});
