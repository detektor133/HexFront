// Страница ↔ Web Worker: запуск локального матча и отправка команд.
import type { Command } from '@hexfront/sim';

import type { FromWorker, ToWorker } from './messages.ts';

export interface LocalMatch {
  send(cmd: Command): void;
  select(hex: number | null): void;
  dispose(): void;
}

/** Запускает sim в Web Worker; onMessage получает снимок каждые 100 мс. */
export function startLocalMatch(
  map: unknown,
  seed: number,
  players: number,
  onMessage: (msg: FromWorker) => void,
): LocalMatch {
  const worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
  const post = (msg: ToWorker): void => worker.postMessage(msg);
  worker.onmessage = (event: MessageEvent<FromWorker>) => onMessage(event.data);
  worker.onerror = (event) => onMessage({ t: 'error', errors: [event.message] });
  post({ t: 'start', map, seed, players });
  return {
    send: (cmd) => post({ t: 'command', cmd }),
    select: (hex) => post({ t: 'select', hex }),
    dispose: () => worker.terminate(),
  };
}
