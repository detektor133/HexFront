// Основная сеть снабжения игрока: узлы (свои гексы с дорогой или городом), связанные со столицей.
// GDD: docs/gdd/04-roads-supply.md — «Сети снабжения». Кэш и изоляция — networkSystem (02/T7).
import { isDepot } from './depot.ts';
import {
  cachedSeaLinks,
  clearSeaLinks,
  markNetworkClean,
  markSupplyDirty,
  networkNeedsRecompute,
  storeSeaLinks,
} from './derived-cache.ts';
import { isPortOf, waterNeighbors } from './port.ts';
import type { MatchState } from './types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { seaField } from '../queries/sea-route.ts';

/** Является ли гекс узлом сети игрока: свой и с дорогой, городом или складом. */
export function isNetworkNode(state: MatchState, playerId: number, hex: HexId): boolean {
  if (state.hexes.owner[hex] !== playerId) return false;
  return (
    state.hexes.road[hex] === 1 ||
    isDepot(state.hexes.building[hex] ?? 0) ||
    state.cities.some((c) => c.hex === hex)
  );
}

/**
 * Морские связи портов игрока: два свои порта связаны, если между ними есть путь по воде не длиннее
 * SEA_MAX_HEXES. Связь работает как дорога: через цепочку портов (складов и городов) снабжение
 * доходит до заморского города или склада от столицы.
 * @returns порт → связанные с ним порты
 */
export function seaLinks(state: MatchState, playerId: number): Map<HexId, HexId[]> {
  const cached = cachedSeaLinks(state, playerId);
  if (cached) return cached;
  const links = new Map<HexId, HexId[]>();
  const ports: HexId[] = [];
  for (let h = 0; h < state.hexes.owner.length; h += 1) {
    if (state.hexes.owner[h] === playerId && isNetworkNode(state, playerId, h)) {
      if (isPortOf(state, playerId, h)) ports.push(h);
    }
  }
  for (const a of ports) {
    const field = seaField(state.map, a);
    const linked = ports.filter(
      (b) => b !== a && waterNeighbors(state.map, b).some((w) => (field.dist[w] ?? -1) > 0),
    );
    if (linked.length > 0) links.set(a, linked);
  }
  storeSeaLinks(state, playerId, links);
  return links;
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
  const sea = seaLinks(state, playerId);
  mask[capital.hex] = 1;
  while (queue.length > 0) {
    const hex = queue.shift() as HexId;
    for (const id of nodeNeighbors(state, playerId, hex, sea)) {
      if (mask[id] === 1) continue;
      mask[id] = 1;
      queue.push(id);
    }
  }
  return mask;
}

// Соседи узла по сети: смежные узлы и связанные морем порты.
function nodeNeighbors(
  state: MatchState,
  playerId: number,
  hex: HexId,
  sea: ReadonlyMap<HexId, readonly HexId[]>,
): HexId[] {
  const { width, height } = state.map;
  const out: HexId[] = [];
  for (const n of neighbors(hexFromId(hex, width))) {
    if (!inBounds(n, width, height)) continue;
    const id = hexId(n, width);
    if (isNetworkNode(state, playerId, id)) out.push(id);
  }
  out.push(...(sea.get(hex) ?? []));
  return out;
}

// Все узлы игрока раскладываются по компонентам; обход по возрастанию HexId, поэтому стартовый
// гекс компоненты — её наименьший HexId, и id сети не зависит от истории.
function components(state: MatchState, playerId: number): { id: number; hexes: HexId[] }[] {
  const { width, height } = state.map;
  const size = width * height;
  const sea = seaLinks(state, playerId);
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
      for (const id of nodeNeighbors(state, playerId, hex, sea)) {
        if (seen[id] === 1) continue;
        seen[id] = 1;
        queue.push(id);
      }
    }
    result.push({ id: playerId * size + start, hexes });
  }
  return result;
}

/** Пересчитывает сети одного игрока: компоненты узлов, основная — со столицей. */
export function recomputeNetworks(state: MatchState, playerId: number, force = false): void {
  if (!force && !networkNeedsRecompute(state, playerId)) return;
  clearSeaLinks(state, playerId);
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
  markSupplyDirty(state, playerId);
  markNetworkClean(state, playerId);
}

/** Пересчитывает сети всех игроков (создание матча и сценарии). */
export function recomputeAllNetworks(state: MatchState): void {
  for (const p of state.players) recomputeNetworks(state, p.id, true);
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
