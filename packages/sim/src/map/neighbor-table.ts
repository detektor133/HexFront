// Таблица соседей карты: 6 индексов на гекс в порядке направлений DIRECTIONS, -1 — за краем.
// Горячие циклы по гексам (обзор, снабжение, зоны контроля, боты) читают её вместо
// `neighbors(hexFromId(...))`, который на каждый гекс выделяет объекты. Порядок соседей тот же,
// поэтому замена не меняет результат.
import type { MapStatic } from './types.ts';
import { hexFromId, hexId, inBounds, neighbors } from '../math/hex.ts';

/** Сторон у гекса. */
export const SIDES = 6;

// Карта в матче не меняется — таблица считается один раз на карту.
const tables = new WeakMap<MapStatic, Int32Array>();

/**
 * Соседи всех гексов карты.
 * @returns плотный массив `hex × SIDES + направление` → HexId соседа или -1
 */
export function neighborTable(map: MapStatic): Int32Array {
  const cached = tables.get(map);
  if (cached) return cached;
  const { width, height } = map;
  const table = new Int32Array(width * height * SIDES).fill(-1);
  for (let h = 0; h < width * height; h += 1) {
    neighbors(hexFromId(h, width)).forEach((n, d) => {
      if (inBounds(n, width, height)) table[h * SIDES + d] = hexId(n, width);
    });
  }
  tables.set(map, table);
  return table;
}
