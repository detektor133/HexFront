// Основная сеть снабжения игрока: узлы (свои гексы с дорогой или городом), связанные со столицей.
// GDD: docs/gdd/04-roads-supply.md — «Сети снабжения». Кэш и изоляция — networkSystem (02/T7).
import type { MatchState } from './types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';

/** Является ли гекс узлом сети игрока: свой и с дорогой или городом. */
export function isNetworkNode(state: MatchState, playerId: number, hex: HexId): boolean {
  if (state.hexes.owner[hex] !== playerId) return false;
  return state.hexes.road[hex] === 1 || state.cities.some((c) => c.hex === hex);
}

/**
 * Маска основной сети: компонента связности узлов, содержащая столицу.
 * @returns 1 — узел основной сети; пустая маска, если столицы нет
 */
export function mainNetworkMask(state: MatchState, playerId: number): Uint8Array {
  const { width, height } = state.map;
  const mask = new Uint8Array(width * height);
  const capitalId = state.players[playerId]?.capitalCityId;
  const capital = state.cities.find((c) => c.id === capitalId && c.owner === playerId);
  if (!capital) return mask;
  const queue: HexId[] = [capital.hex];
  mask[capital.hex] = 1;
  while (queue.length > 0) {
    const hex = queue.shift() as HexId;
    for (const n of neighbors(hexFromId(hex, width))) {
      if (!inBounds(n, width, height)) continue;
      const id = hexId(n, width);
      if (mask[id] === 1 || !isNetworkNode(state, playerId, id)) continue;
      mask[id] = 1;
      queue.push(id);
    }
  }
  return mask;
}
