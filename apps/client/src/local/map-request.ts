import { QUICK_MATCH_SEEDS } from '../routes.ts';

/** Карты матча: готовые (Европа, регионы мира, процедурные, малая, крошечная) и сгенерированная по зерну. */
export const MAP_IDS = [
  'europe',
  'gen',
  'small',
  'tiny',
  'mediterranean',
  'north',
  'namerica',
  'japan',
  'mideast',
  'continent',
  'archipelago',
] as const;
export type MapId = (typeof MAP_IDS)[number];

export interface MapRequest {
  readonly id: MapId;
  readonly seed: number;
  readonly players: number;
}

const DEFAULT_SEED = 42;
const DEFAULT_PLAYERS = 2;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 30;

function integerParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = Number(params.get(name));
  return Number.isSafeInteger(value) ? value : fallback;
}

/** Читает параметры карты, ограничивая число игроков диапазоном генератора. */
export function readMapRequest(search: string): MapRequest {
  const params = new URLSearchParams(search);
  const players = Math.min(
    MAX_PLAYERS,
    Math.max(MIN_PLAYERS, integerParam(params, 'players', DEFAULT_PLAYERS)),
  );
  const seed = integerParam(params, 'seed', DEFAULT_SEED);
  return {
    id: MAP_IDS.find((id) => id === params.get('map')) ?? 'small',
    seed,
    players,
  };
}

/** Возвращает URL карты, которую отдаёт dev-сервер или production-сборка. */
export function mapUrl(request: MapRequest): string {
  if (request.id !== 'gen') return `/maps/${request.id}.json`;
  // Готовая карта на 30 мест; игроков в матче может быть меньше — лишние места пустуют.
  if (QUICK_MATCH_SEEDS.includes(request.seed as (typeof QUICK_MATCH_SEEDS)[number])) {
    return `/maps/gen-${request.seed}-30.json`;
  }
  const params = new URLSearchParams({
    seed: String(request.seed),
    players: '30',
  });
  return `/maps/gen.json?${params.toString()}`;
}
