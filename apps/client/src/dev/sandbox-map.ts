export interface SandboxMapRequest {
  readonly id: 'small' | 'gen';
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

export function readSandboxMap(search: string): SandboxMapRequest {
  const params = new URLSearchParams(search);
  const players = Math.min(
    MAX_PLAYERS,
    Math.max(MIN_PLAYERS, integerParam(params, 'players', DEFAULT_PLAYERS)),
  );
  const seed = integerParam(params, 'seed', DEFAULT_SEED);
  return {
    id: params.get('map') === 'gen' ? 'gen' : 'small',
    seed,
    players,
  };
}

export function sandboxMapUrl(request: SandboxMapRequest): string {
  if (request.id === 'small') return '/maps/small.json';
  const params = new URLSearchParams({
    seed: String(request.seed),
    players: String(request.players),
  });
  return `/maps/gen.json?${params.toString()}`;
}
