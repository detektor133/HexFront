import { readMapRequest, type MapRequest } from './map-request.ts';

const SPEED_MAX = 20;

export interface LocalMatchSetup {
  readonly count: number;
  readonly bots: readonly number[];
  readonly speed: number;
  readonly map: MapRequest;
  readonly playerName: string | null;
  readonly playerColor: string | null;
  readonly autoCommand: boolean | null;
}

/** Состав локального матча: игрок 0 — человек, остальные участники — боты. */
export function readLocalMatchSetup(search: string): LocalMatchSetup {
  const params = new URLSearchParams(search);
  const map = readMapRequest(search);
  const watch = params.get('watch') === '1';
  const bots = Array.from({ length: map.players }, (_, playerId) => playerId).filter(
    (playerId) => watch || playerId !== 0,
  );
  const requestedSpeed = Number(params.get('speed') ?? 1);
  const speed =
    params.get('freezeTime') === '1'
      ? 0
      : Math.min(
          SPEED_MAX,
          Math.max(0, Number.isFinite(requestedSpeed) ? Math.floor(requestedSpeed) : 1),
        );
  const auto = params.get('auto');
  return {
    count: map.players,
    bots,
    speed,
    map,
    playerName: params.get('name'),
    playerColor: params.get('color'),
    autoCommand: auto === null ? null : auto === '1',
  };
}
