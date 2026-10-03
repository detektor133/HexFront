// Страница ↔ Web Worker: запуск локального матча и отправка команд.
import type { Command } from '@hexfront/sim';

import type { FromWorker, ToWorker } from './messages.ts';

export interface LocalMatch {
  send(cmd: Command): void;
  setFog(on: boolean): void;
  select(hex: number | null): void;
  dispose(): void;
}

/** Запускает sim в Web Worker; onMessage получает снимок каждые 100 мс. */
export function startLocalMatch(
  map: unknown,
  seed: number,
  players: { readonly count: number; readonly bots: readonly number[]; readonly speed: number },
  onMessage: (msg: FromWorker) => void,
): LocalMatch {
  const worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
  const post = (msg: ToWorker): void => worker.postMessage(msg);
  worker.onmessage = (event: MessageEvent<FromWorker>) => onMessage(event.data);
  worker.onerror = (event) => onMessage({ t: 'error', errors: [event.message] });
  post({
    t: 'start',
    map,
    seed,
    players: players.count,
    bots: players.bots,
    speed: players.speed,
    fog: true,
  });
  return {
    send: (cmd) => post({ t: 'command', cmd }),
    setFog: (on) => post({ t: 'fog', on }),
    select: (hex) => post({ t: 'select', hex }),
    dispose: () => worker.terminate(),
  };
}
