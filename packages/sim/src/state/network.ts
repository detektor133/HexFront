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

// Все узлы игрока раскладываются по компонентам; обход по возрастанию HexId, поэтому стартовый
// гекс компоненты — её наименьший HexId, и id сети не зависит от истории.
function components(state: MatchState, playerId: number): { id: number; hexes: HexId[] }[] {
  const { width, height } = state.map;
  const size = width * height;
  const seen = new Uint8Array(size);
  const result: { id: number; hexes: HexId[] }[] = [];
  for (let start = 0; start < size; start += 1) {
    if (seen[start] === 1 || !isNetworkNode(state, playerId, start)) continue;
    const hexes: HexId[] = [];
    const queue: HexId[] = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const hex = queue.shift() as HexId;
      hexes.push(hex);
      for (const n of neighbors(hexFromId(hex, width))) {
        if (!inBounds(n, width, height)) continue;
        const id = hexId(n, width);
        if (seen[id] === 1 || !isNetworkNode(state, playerId, id)) continue;
        seen[id] = 1;
        queue.push(id);
      }
    }
    result.push({ id: playerId * size + start, hexes });
  }
  return result;
}

/** Пересчитывает сети одного игрока: компоненты узлов, основная — со столицей. */
export function recomputeNetworks(state: MatchState, playerId: number): void {
  const { network } = state.hexes;
  const own = new Set(state.networks.filter((n) => n.owner === playerId).map((n) => n.id));
  network.forEach((id, hex) => {
    if (own.has(id)) network[hex] = -1;
  });
  const capitalId = state.players[playerId]?.capitalCityId;
  const capitalHex = state.cities.find((c) => c.id === capitalId && c.owner === playerId)?.hex;
  const fresh = components(state, playerId).map((c) => {
    for (const hex of c.hexes) network[hex] = c.id;
    return {
      id: c.id,
      owner: playerId,
      isMain: capitalHex !== undefined && c.hexes.includes(capitalHex),
    };
  });
  state.networks = [...state.networks.filter((n) => n.owner !== playerId), ...fresh].sort(
    (a, b) => a.id - b.id,
  );
}

/** Пересчитывает сети всех игроков (создание матча и сценарии). */
export function recomputeAllNetworks(state: MatchState): void {
  for (const p of state.players) recomputeNetworks(state, p.id);
}

/**
 * Изолирован ли город: его сеть не основная. До первого пересчёта после основания города
 * (≤ 1 с) сеть неизвестна — город считается связанным.
 */
export function isCityIsolated(state: MatchState, cityId: number): boolean {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return false;
  const id = state.hexes.network[city.hex] ?? -1;
  if (id < 0) return false;
  return state.networks.find((n) => n.id === id)?.isMain !== true;
}
