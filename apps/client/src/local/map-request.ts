/** Карты матча: готовые (Европа, регионы мира, малая, крошечная) и случайная, которую строит устройство по зерну. */
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
  /** Стартовых точек случайной карты (`size`): малая 12, средняя 30, большая 60. */
  readonly size: number;
}

const DEFAULT_SEED = 42;
const DEFAULT_PLAYERS = 2;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 60;
const DEFAULT_SIZE = 30;
const MIN_SIZE = 4;
const MAX_SIZE = 60;

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
  const sized = params.has('size') ? integerParam(params, 'size', DEFAULT_SIZE) : DEFAULT_SIZE;
  const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, sized));
  return {
    id: MAP_IDS.find((id) => id === params.get('map')) ?? 'small',
    seed,
    players,
    size,
  };
}

/** Адрес готовой карты, которую отдаёт dev-сервер или production-сборка (кроме случайной). */
export function mapUrl(request: MapRequest): string {
  return `/maps/${request.id}.json`;
}

/**
 * JSON карты: готовую берёт файлом, случайную строит по зерну и размеру на месте. Генератор
 * подгружается отдельным куском, он нужен только случайным картам.
 */
export async function loadMapJson(request: MapRequest): Promise<unknown> {
  if (request.id === 'gen') {
    const { generateGenMap } = await import('@hexfront/mapgen');
    return generateGenMap(request.seed, request.size);
  }
  const response = await fetch(mapUrl(request));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
