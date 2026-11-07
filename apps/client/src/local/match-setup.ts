import type { BotLevel } from '@hexfront/sim';

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
  readonly initialGold: number | null;
  /** Глава обучения (`tutorial=core`): матч-урок, соперник пассивен, автозанятие не включается. */
  readonly tutorial: string | null;
  /** Сложность ботов (`difficulty=easy|normal|hard`); без параметра — полная сила. */
  readonly botLevel: BotLevel;
}

/** Сложность из адреса: «hard» — полная сила бота (`medium` в sim). */
function botLevelParam(value: string | null): BotLevel {
  if (value === 'easy') return 'easy';
  if (value === 'normal') return 'normal';
  return 'medium';
}

/** Состав локального матча: игрок 0 — человек, остальные участники — боты. */
// Золото в параметре — целое число монет; в состоянии оно fixed-point (×1000).
function goldParam(value: string | null): number | null {
  if (value === null || value === '') return null;
  const coins = Number(value);
  return Number.isInteger(coins) && coins >= 0 ? coins * 1000 : null;
}

export function readLocalMatchSetup(search: string): LocalMatchSetup {
  const params = new URLSearchParams(search);
  const map = readMapRequest(search);
  const watch = params.get('watch') === '1';
  const tutorial = params.get('tutorial');
  // Урок: соперник не думает (без бота), поэтому он стоит и ждёт, пока игрок дойдёт до него.
  const bots =
    tutorial !== null
      ? []
      : Array.from({ length: map.players }, (_, playerId) => playerId).filter(
          (playerId) => watch || playerId !== 0,
        );
  const speed =
    params.get('freezeTime') === '1'
      ? 0
      : Math.min(SPEED_MAX, Math.max(1, Math.floor(Number(params.get('speed') ?? 1)) || 1));
  const auto = params.get('auto');
  return {
    count: map.players,
    bots,
    speed,
    map,
    playerName: params.get('name'),
    playerColor: params.get('color'),
    autoCommand: auto === null ? null : auto === '1',
    // initialGold=N — стартовое золото игрока в золоте (для проверки закупки), 0 — без золота.
    initialGold: goldParam(params.get('initialGold')),
    tutorial,
    botLevel: botLevelParam(params.get('difficulty')),
  };
}
