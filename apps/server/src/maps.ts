// Карты комнат: генерация случайных по зерну, кэш процесса и готовые карты меню.
import { readFileSync } from 'node:fs';

import { generateGenMap } from '@hexfront/mapgen';
import type { LobbyMap } from '@hexfront/protocol';
import { loadMap, type MapStatic } from '@hexfront/sim';

/** Случайная карта комнаты: клиент строит ровно такую же по зерну и числу стартовых точек. */
export function quickMatchMap(seed: number, spawns: number): MapStatic {
  const loaded = loadMap(generateGenMap(seed, spawns));
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  return loaded.map;
}

/** Недавние карты потока: sim карту не меняет, комнаты делят её; старые вытесняются. */
const MAP_CACHE_LIMIT = 48;
const mapCache = new Map<string, MapStatic>();

export function cachedMap(seed: number, size: number): MapStatic {
  const key = `${seed}:${size}`;
  let map = mapCache.get(key);
  if (map === undefined) {
    map = quickMatchMap(seed, size);
    mapCache.set(key, map);
    const oldest = mapCache.keys().next().value;
    if (mapCache.size > MAP_CACHE_LIMIT && oldest !== undefined) mapCache.delete(oldest);
  }
  return map;
}

/** Готовые карты меню (Европа, регионы мира, процедурные, малая, крошечная): те же файлы, что у клиента. */
const staticMaps = new Map<string, MapStatic>();

export function staticMap(name: Exclude<LobbyMap, 'gen'>): MapStatic {
  let map = staticMaps.get(name);
  if (map === undefined) {
    const file = new URL(`../../../packages/mapgen/maps/${name}.json`, import.meta.url);
    const loaded = loadMap(JSON.parse(readFileSync(file, 'utf8')) as unknown);
    if (!loaded.ok) throw new Error(loaded.errors.join('; '));
    map = loaded.map;
    staticMaps.set(name, map);
  }
  return map;
}

/**
 * Пул карт быстрого боя: случайная по зерну и готовые карты меню. Крошечная не входит (на двоих
 * комната не набирается), малая — на шестерых; число игроков не превышает числа стартов карты.
 */
const QUICK_POOL: readonly LobbyMap[] = [
  'gen',
  'gen',
  'europe',
  'mediterranean',
  'north',
  'namerica',
  'japan',
  'mideast',
  'continent',
  'archipelago',
  'small',
];

export interface QuickPick {
  readonly name: LobbyMap;
  readonly map: MapStatic;
  readonly size: number;
}

/** Карта и число игроков открытой комнаты: по зерну берётся из пула, зерно у всех клиентов одно. */
export function pickQuickMap(seed: number, size: number): QuickPick {
  const name = QUICK_POOL[(seed >>> 0) % QUICK_POOL.length] ?? 'gen';
  if (name === 'gen') return { name, map: cachedMap(seed, size), size };
  const map = staticMap(name);
  return { name, map, size: Math.max(2, Math.min(size, map.spawns.length)) };
}
