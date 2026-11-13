// Карты быстрого матча: генерация, кэш процесса и прогрев между тиками.
import { readFileSync } from 'node:fs';

import { generateMap, QUICK_MATCH_MAP_SIZE } from '@hexfront/mapgen';
import { QUICK_MATCH_SEEDS } from '@hexfront/protocol';
import { loadMap, type MapStatic } from '@hexfront/sim';

/** Карта комнаты: та же, что клиент берёт готовым файлом `gen-<сид>-30.json` (размер общий). */
export function quickMatchMap(seed: number, size: number): MapStatic {
  const loaded = loadMap(generateMap(seed, { ...QUICK_MATCH_MAP_SIZE, players: size }));
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  return loaded.map;
}

/** Готовые карты потока: sim карту не меняет, комнаты делят её. */
const mapCache = new Map<string, MapStatic>();

export function cachedMap(seed: number, size: number): MapStatic {
  const key = `${seed}:${size}`;
  let map = mapCache.get(key);
  if (map === undefined) {
    map = quickMatchMap(seed, size);
    mapCache.set(key, map);
  }
  return map;
}

/**
 * Прогревает карты быстрого матча по одной между тиками (генерация 30–60 мс, холодная — дольше), чтобы
 * создание комнаты не останавливало игроков других комнат потока.
 */
export function warmMaps(size: number, seeds: readonly number[] = QUICK_MATCH_SEEDS): void {
  let index = 0;
  const next = (): void => {
    const seed = seeds[index];
    if (seed === undefined) return;
    index += 1;
    cachedMap(seed, size);
    setTimeout(next, 50);
  };
  setTimeout(next, 1000);
}

/** Готовые карты меню (Европа, малая, крошечная): те же файлы, что у клиента. */
const staticMaps = new Map<string, MapStatic>();

export function staticMap(name: 'europe' | 'small' | 'tiny'): MapStatic {
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
