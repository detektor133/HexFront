// Загрузка карты v1 из JSON: разбор структуры, декодирование массивов, проверка правил.
// GDD: docs/gdd/01-map.md — «Формат карты», «Объекты на карте при старте».

import { decodeBase64, unpackBits } from './codec.ts';
import { FEATURE, TERRAIN_NAMES, type FeatureName, type MapCity, type MapStatic } from './types.ts';
import { validateMap } from './validate.ts';
import { hexId, inBounds, neighbor, type Direction, type Hex } from '../math/hex.ts';

/** Результат загрузки: карта или список понятных ошибок. */
export type MapLoadResult =
  | { readonly ok: true; readonly map: MapStatic }
  | { readonly ok: false; readonly errors: readonly string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const isHexLike = (v: unknown): v is Obj & Hex => isObj(v) && isInt(v.q) && isInt(v.r);
const FEATURE_NAMES = new Set<string>(['fertile', 'mine', 'pass']);
const RIVER_DIRS_STORED = 3;
const MAX_CITY_LEVEL = 3;

interface Builder {
  readonly errors: string[];
  readonly width: number;
  readonly height: number;
}

function checkPos(b: Builder, h: Hex, what: string): boolean {
  if (inBounds(h, b.width, b.height)) return true;
  b.errors.push(`${what} (${h.q}, ${h.r}) вне карты ${b.width}×${b.height}`);
  return false;
}

function readTerrain(b: Builder, raw: unknown): Uint8Array {
  const size = b.width * b.height;
  const bytes = typeof raw === 'string' ? decodeBase64(raw) : null;
  if (!bytes) {
    b.errors.push('terrain: не строка base64');
    return new Uint8Array(size);
  }
  if (bytes.length !== size) {
    b.errors.push(`terrain: ${bytes.length} байт, ожидалось width·height = ${size}`);
    return new Uint8Array(size);
  }
  const bad = bytes.findIndex((c) => c >= TERRAIN_NAMES.length);
  if (bad >= 0) b.errors.push(`terrain: неизвестный код местности ${bytes[bad]} в гексе #${bad}`);
  return bytes;
}

function readRoads(b: Builder, raw: unknown): Uint8Array {
  const size = b.width * b.height;
  const bytes = typeof raw === 'string' ? decodeBase64(raw) : null;
  const expected = (size + 7) >> 3;
  if (!bytes || bytes.length !== expected) {
    b.errors.push(`roads: ожидался base64-битсет из ${expected} байт`);
    return new Uint8Array(size);
  }
  return unpackBits(bytes, size);
}

function readFeatures(b: Builder, raw: unknown): Uint8Array {
  const out = new Uint8Array(b.width * b.height);
  if (!Array.isArray(raw)) {
    b.errors.push('features: ожидался массив');
    return out;
  }
  raw.forEach((f: unknown, i) => {
    if (!isHexLike(f) || typeof f.type !== 'string' || !FEATURE_NAMES.has(f.type)) {
      b.errors.push(`features[${i}]: ожидалось { q, r, type: fertile | mine | pass }`);
      return;
    }
    if (!checkPos(b, f, `features[${i}]`)) return;
    const id = hexId(f, b.width);
    if (out[id] !== FEATURE.none) b.errors.push(`features[${i}]: на гексе уже есть особенность`);
    out[id] = FEATURE[f.type as FeatureName];
  });
  return out;
}

function readRivers(b: Builder, raw: unknown): Uint8Array {
  const out = new Uint8Array(b.width * b.height);
  if (!Array.isArray(raw)) {
    b.errors.push('riverEdges: ожидался массив');
    return out;
  }
  raw.forEach((e: unknown, i) => {
    if (!Array.isArray(e) || e.length !== 3 || !e.every(isInt)) {
      b.errors.push(`riverEdges[${i}]: ожидалось [q, r, dir]`);
      return;
    }
    const [q, r, dir] = e as [number, number, number];
    if (dir < 0 || dir >= RIVER_DIRS_STORED) {
      b.errors.push(`riverEdges[${i}]: dir = ${dir}, допустимо 0–2`);
      return;
    }
    const from = { q, r };
    const to = neighbor(from, dir as Direction);
    if (!checkPos(b, from, `riverEdges[${i}]`) || !checkPos(b, to, `riverEdges[${i}] (сосед)`)) {
      return;
    }
    const a = hexId(from, b.width);
    const c = hexId(to, b.width);
    out[a] = (out[a] ?? 0) | (1 << dir);
    out[c] = (out[c] ?? 0) | (1 << (dir + 3));
  });
  return out;
}

function readCity(b: Builder, c: unknown, i: number): MapCity | null {
  if (
    !isHexLike(c) ||
    !isInt(c.id) ||
    typeof c.name !== 'string' ||
    !isInt(c.level) ||
    !isInt(c.garrison)
  ) {
    b.errors.push(`cities[${i}]: ожидалось { id, q, r, name, level, garrison }`);
    return null;
  }
  const city: MapCity = {
    id: c.id,
    q: c.q,
    r: c.r,
    name: c.name,
    level: c.level,
    garrison: c.garrison,
  };
  if (city.level < 1 || city.level > MAX_CITY_LEVEL) {
    b.errors.push(`cities[${i}]: уровень ${city.level}, допустимо 1–${MAX_CITY_LEVEL}`);
  }
  if (city.garrison < 0) b.errors.push(`cities[${i}]: отрицательный гарнизон`);
  return checkPos(b, city, `город «${city.name}»`) ? city : null;
}

function readCities(b: Builder, raw: unknown): MapCity[] {
  if (!Array.isArray(raw)) {
    b.errors.push('cities: ожидался массив');
    return [];
  }
  const cities: MapCity[] = [];
  raw.forEach((c: unknown, i) => {
    const city = readCity(b, c, i);
    if (!city) return;
    if (cities.some((x) => x.id === city.id)) b.errors.push(`cities[${i}]: повтор id ${city.id}`);
    cities.push(city);
  });
  return cities.sort((x, y) => x.id - y.id);
}

function readSpawns(b: Builder, raw: unknown): Hex[] {
  if (!Array.isArray(raw)) {
    b.errors.push('spawns: ожидался массив');
    return [];
  }
  const spawns: Hex[] = [];
  raw.forEach((s: unknown, i) => {
    if (!isHexLike(s)) b.errors.push(`spawns[${i}]: ожидалось { q, r }`);
    else if (checkPos(b, s, `spawns[${i}]`)) spawns.push({ q: s.q, r: s.r });
  });
  return spawns;
}

function readHeader(json: Obj, errors: string[]): { id: string; w: number; h: number } | null {
  if (json.version !== 1) errors.push(`version: ${String(json.version)}, поддерживается только 1`);
  if (typeof json.id !== 'string' || json.id === '') errors.push('id: ожидалась непустая строка');
  const { width, height } = json;
  if (!isInt(width) || !isInt(height) || width <= 0 || height <= 0) {
    errors.push('width/height: ожидались положительные целые');
    return null;
  }
  return errors.length > 0 ? null : { id: String(json.id), w: width, h: height };
}

/**
 * Разбирает и проверяет карту формата v1 (JSON уже распарсен, содержимое не доверенное).
 * @returns карта или все найденные ошибки
 */
export function loadMap(json: unknown): MapLoadResult {
  if (!isObj(json)) return { ok: false, errors: ['карта: ожидался JSON-объект'] };
  const errors: string[] = [];
  const header = readHeader(json, errors);
  if (!header) return { ok: false, errors };
  const b: Builder = { errors, width: header.w, height: header.h };
  const map: MapStatic = {
    version: 1,
    id: header.id,
    width: header.w,
    height: header.h,
    terrain: readTerrain(b, json.terrain),
    features: readFeatures(b, json.features),
    rivers: readRivers(b, json.riverEdges),
    roads: readRoads(b, json.roads),
    cities: readCities(b, json.cities),
    spawns: readSpawns(b, json.spawns),
  };
  if (errors.length > 0) return { ok: false, errors };
  const semantic = validateMap(map);
  return semantic.length > 0 ? { ok: false, errors: semantic } : { ok: true, map };
}
