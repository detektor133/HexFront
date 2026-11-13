import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { quickMatchMap } from '../src/hub.ts';

const SCRIPT = fileURLToPath(
  new URL('../../../packages/mapgen/scripts/generate-json.ts', import.meta.url),
);

describe('случайная карта сервера совпадает с картой, которую строит клиент', () => {
  it.each([
    [42, 30],
    [123_456_789, 12],
    [1_999_999_999, 60],
  ])(
    'зерно %i, стартовых точек %i',
    (seed, spawns) => {
      // Клиент строит карту тем же кодом генератора на месте: номера гексов должны совпасть.
      const json: unknown = JSON.parse(
        execFileSync(
          process.execPath,
          ['--experimental-strip-types', SCRIPT, String(seed), String(spawns)],
          { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        ),
      );
      const client = loadMap(json);
      if (!client.ok) throw new Error(client.errors.join('; '));
      const server = quickMatchMap(seed, spawns);
      expect([server.width, server.height]).toEqual([client.map.width, client.map.height]);
      expect([...server.terrain]).toEqual([...client.map.terrain]);
      expect(server.spawns).toEqual(client.map.spawns);
      expect(server.spawns).toHaveLength(spawns);
      expect(server.cities).toEqual(client.map.cities);
    },
    60_000,
  );
});
