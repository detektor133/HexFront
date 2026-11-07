// Порт (03-cities-buildings.md, «Порты»): склад или город, рядом с которым есть клетка воды. Ничьи
// города у воды — тоже порты: захватив город, игрок получает порт.
import { depotLevel } from './depot.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';

/** Всё, что нужно порту от мира: карта, владельцы гексов, здания и города. */
export interface PortGround {
  readonly map: MapStatic;
  readonly hexes: { readonly owner: ArrayLike<number>; readonly building: ArrayLike<number> };
  readonly cities: readonly { readonly hex: number; readonly level: number }[];
}

/** Соседние клетки воды гекса, в стабильном порядке обхода соседей. */
export function waterNeighbors(map: MapStatic, hex: HexId): HexId[] {
  return neighbors(hexFromId(hex, map.width))
    .filter((n) => inBounds(n, map.width, map.height))
    .map((n) => hexId(n, map.width))
    .filter((id) => map.terrain[id] === TERRAIN.water);
}

/**
 * Уровень порта на гексе: больший из уровня склада и уровня города; 0 — ни склада, ни города.
 * От уровня зависит вместимость порта.
 */
export function portLevel(g: PortGround, hex: HexId): number {
  const city = g.cities.find((c) => c.hex === hex);
  return Math.max(depotLevel(g.hexes.building[hex] ?? 0), city?.level ?? 0);
}

/** Гекс — порт: склад или город (чей угодно) и рядом вода. */
export function isPortHex(g: PortGround, hex: HexId): boolean {
  return portLevel(g, hex) > 0 && waterNeighbors(g.map, hex).length > 0;
}

/**
 * Гекс — порт игрока: гекс его, на нём склад или город, а рядом есть вода.
 * @returns true, если с этого гекса можно отплыть
 */
export function isPortOf(g: PortGround, owner: number, hex: HexId): boolean {
  return g.hexes.owner[hex] === owner && isPortHex(g, hex);
}
