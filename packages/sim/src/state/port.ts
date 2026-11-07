// Порт — склад у моря (03-cities-buildings.md, «Порты»): отдельного здания нет, это признак склада,
// рядом с которым есть клетка воды. Город без склада портом не является.
import { isDepot } from './depot.ts';
import type { MapStatic } from '../map/types.ts';
import { TERRAIN } from '../map/types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';

/** Всё, что нужно порту от мира: карта, владельцы гексов и здания. */
export interface PortGround {
  readonly map: MapStatic;
  readonly hexes: { readonly owner: ArrayLike<number>; readonly building: ArrayLike<number> };
}

/** Соседние клетки воды гекса, в стабильном порядке обхода соседей. */
export function waterNeighbors(map: MapStatic, hex: HexId): HexId[] {
  return neighbors(hexFromId(hex, map.width))
    .filter((n) => inBounds(n, map.width, map.height))
    .map((n) => hexId(n, map.width))
    .filter((id) => map.terrain[id] === TERRAIN.water);
}

/**
 * Гекс — порт игрока: на нём его склад, а рядом есть вода.
 * @returns true, если с этого гекса можно отплыть
 */
export function isPortOf(g: PortGround, owner: number, hex: HexId): boolean {
  return (
    g.hexes.owner[hex] === owner &&
    isDepot(g.hexes.building[hex] ?? 0) &&
    waterNeighbors(g.map, hex).length > 0
  );
}
