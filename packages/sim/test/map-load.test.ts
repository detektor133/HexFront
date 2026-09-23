import { describe, expect, it } from 'vitest';

import small from '../../mapgen/maps/small.json' with { type: 'json' };
import tiny from '../../mapgen/maps/tiny.json' with { type: 'json' };
import { decodeBase64, encodeBase64, packBits, unpackBits } from '../src/map/codec.ts';
import { loadMap } from '../src/map/load.ts';
import { FEATURE, TERRAIN, type MapJson } from '../src/map/types.ts';
import { hexId, neighbor } from '../src/math/hex.ts';

const clone = (m: unknown): MapJson => JSON.parse(JSON.stringify(m)) as MapJson;

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('в эталонной карте нет ожидаемого элемента');
  return v;
}

function setTerrain(json: MapJson, q: number, r: number, code: number): MapJson {
  const bytes = decodeBase64(json.terrain);
  if (!bytes) throw new Error('битый terrain в эталонной карте');
  bytes[hexId({ q, r }, json.width)] = code;
  return { ...json, terrain: encodeBase64(bytes) };
}

function errorsOf(json: unknown): readonly string[] {
  const result = loadMap(json);
  return result.ok ? [] : result.errors;
}

describe('кодек карты', () => {
  it('base64 кодирует и декодирует любые байты', () => {
    for (let n = 0; n < 10; n += 1) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 0xff);
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
    expect(encodeBase64(Uint8Array.from([77, 97, 110]))).toBe('TWFu');
  });

  it('base64 отклоняет неверную строку', () => {
    expect(decodeBase64('abc')).toBeNull();
    expect(decodeBase64('ab!=')).toBeNull();
  });

  it('битсет упаковывается младшим битом вперёд', () => {
    const flags = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    const packed = packBits(flags);
    expect([...packed]).toEqual([1, 2]);
    expect(unpackBits(packed, flags.length)).toEqual(flags);
  });
});

describe('загрузка карты v1', () => {
  it.each([
    ['tiny', tiny, 20, 15, 2],
    ['small', small, 40, 30, 6],
  ])('карта %s загружается без ошибок', (_id, json, width, height, players) => {
    const result = loadMap(json);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.map.width).toBe(width);
    expect(result.map.height).toBe(height);
    expect(result.map.spawns).toHaveLength(players);
    expect(result.map.cities.map((c) => c.id)).toEqual(
      [...result.map.cities.map((c) => c.id)].sort((a, b) => a - b),
    );
  });

  it('река хранится с обеих сторон ребра', () => {
    const result = loadMap(tiny);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const [q = 0, r = 0, dir = 0] = (tiny as MapJson).riverEdges[0] ?? [];
    const other = neighbor({ q, r }, dir as 0);
    expect(must(result.map.rivers[hexId({ q, r }, 20)]) & (1 << dir)).not.toBe(0);
    expect(must(result.map.rivers[hexId(other, 20)]) & (1 << (dir + 3))).not.toBe(0);
  });

  it('особые гексы раскладываются по массиву features', () => {
    const result = loadMap(tiny);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const mine = (tiny as MapJson).features.find((f) => f.type === 'mine');
    expect(mine).toBeDefined();
    expect(result.map.features[hexId(must(mine), 20)]).toBe(FEATURE.mine);
  });

  describe('валидатор отклоняет испорченные карты', () => {
    const base = (): MapJson => clone(tiny);

    it('размер terrain не совпадает с width·height', () => {
      expect(errorsOf({ ...base(), width: 21 })).toContainEqual(
        expect.stringContaining('ожидалось width·height = 315'),
      );
    });

    it('город за границей карты', () => {
      const json = base();
      json.cities[0] = { ...must(json.cities[0]), q: 50 };
      expect(errorsOf(json)).toContainEqual(expect.stringMatching(/Вельск.*вне карты 20×15/));
    });

    it('город на воде', () => {
      const c = must(base().cities[1]);
      expect(errorsOf(setTerrain(base(), c.q, c.r, TERRAIN.water))).toContainEqual(
        expect.stringMatching(/Ольховка.*стоит на воде/),
      );
    });

    it('города ближе 4 гексов', () => {
      const json = base();
      const c = must(json.cities[0]);
      json.cities.push({ ...c, id: 99, name: 'Близкий', q: c.q + 3 });
      expect(errorsOf(json)).toContainEqual(
        expect.stringMatching(/Близкий.*дистанция 3, минимум 4/),
      );
    });

    it('спавн на непроходимом гексе', () => {
      const s = must(base().spawns[0]);
      expect(errorsOf(setTerrain(base(), s.q, s.r, TERRAIN.water))).toContainEqual(
        expect.stringMatching(/спавн #0.*стоит на воде/),
      );
    });

    it('ребро реки с направлением вне 0–2', () => {
      const json = base();
      json.riverEdges.push([5, 5, 4]);
      expect(errorsOf(json)).toContainEqual('riverEdges[3]: dir = 4, допустимо 0–2');
    });

    it('неизвестный код местности', () => {
      expect(errorsOf(setTerrain(base(), 5, 5, 9))).toContainEqual(
        expect.stringContaining('неизвестный код местности 9'),
      );
    });

    it('дорога по воде', () => {
      const json = base();
      const roads = unpackBits(must(decodeBase64(json.roads)), 300);
      roads[0] = 1;
      expect(errorsOf({ ...json, roads: encodeBase64(packBits(roads)) })).toContainEqual(
        expect.stringMatching(/дорога .* «water»/),
      );
    });

    it('неподдерживаемая версия и не объект', () => {
      expect(errorsOf({ ...base(), version: 2 })).toContainEqual(
        'version: 2, поддерживается только 1',
      );
      expect(errorsOf('карта')).toEqual(['карта: ожидался JSON-объект']);
    });

    it('карта без спавнов', () => {
      expect(errorsOf({ ...base(), spawns: [] })).toContain('на карте нет ни одного спавна');
    });
  });
});
