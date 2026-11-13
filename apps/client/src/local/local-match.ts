// Страница ↔ Web Worker: запуск локального матча и отправка команд.
import type { BotLevel } from '@hexfront/sim';

import type { LocalMatch } from './match-api.ts';
import type { FromWorker, ToWorker } from './messages.ts';
import { readCityNames } from '../settings/city-names-pref.ts';

export type { LocalMatch };

/** Запускает sim в Web Worker; onMessage получает снимок каждые 100 мс. */
export function startLocalMatch(
  map: unknown,
  seed: number,
  players: { readonly count: number; readonly bots: readonly number[]; readonly speed: number },
  onMessage: (msg: FromWorker) => void,
  options: {
    readonly telemetry?: boolean;
    readonly fog?: boolean;
    readonly playerName?: string;
    readonly playerColors?: readonly string[];
    readonly autoCommand?: boolean;
    readonly initialGold?: number | null;
    readonly tutorial?: boolean;
    readonly botLevel?: BotLevel;
    readonly spawn?: number | null;
    readonly freeStarts?: boolean;
  } = {},
): LocalMatch {
  const worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
  const post = (msg: ToWorker): void => worker.postMessage(msg);
  worker.onmessage = (event: MessageEvent<FromWorker>) => onMessage(event.data);
  worker.onerror = (event) => onMessage({ t: 'error', errors: [event.message] });
  const start: ToWorker = {
    t: 'start',
    map,
    seed,
    players: players.count,
    bots: players.bots,
    speed: players.speed,
    fog: options.fog ?? true,
    ...(options.telemetry ? { telemetry: true } : {}),
    ...(options.playerName ? { playerName: options.playerName } : {}),
    ...(options.playerColors ? { playerColors: options.playerColors } : {}),
    ...(options.tutorial ? { tutorial: true } : {}),
    ...(options.botLevel ? { botLevel: options.botLevel } : {}),
    ...(options.spawn !== undefined && options.spawn !== null ? { spawn: options.spawn } : {}),
    ...(options.freeStarts ? { freeStarts: true } : {}),
    ...(readCityNames().length > 0 ? { cityNames: readCityNames() } : {}),
    ...(options.initialGold !== undefined && options.initialGold !== null
      ? { initialGold: options.initialGold }
      : {}),
  };
  post(start);
  if (options.autoCommand) post({ t: 'command', cmd: { t: 'setAutoCommand', on: true } });
  return {
    send: (cmd) => post({ t: 'command', cmd }),
    setFog: (on) => post({ t: 'fog', on }),
    setTutorialStage: (stage) => post({ t: 'tutorialStage', stage }),
    setPaused: (on) => post({ t: 'pause', on }),
    step: () => post({ t: 'step' }),
    setSpeed: (value) => post({ t: 'speed', value }),
    setObserver: (playerId) => post({ t: 'observer', playerId }),
    setView: (playerId, fog) => post({ t: 'view', playerId, fog }),
    select: (hex) => post({ t: 'select', hex }),
    previewPath: (requestId, unitIds, to, via) =>
      post({ t: 'previewPath', requestId, unitIds, to, via }),
    requestMask: (requestId, mode) => post({ t: 'mapMask', requestId, mode }),
    ack: (seq) => post({ t: 'ack', seq }),
    dispose: () => worker.terminate(),
  };
}
