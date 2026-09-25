// Web Worker локального режима: тик 100 мс, снимок игроку после каждого тика.
import { TICK_MS } from '@hexfront/sim';

import { createLocalEngine, type LocalEngine } from './engine.ts';
import type { FromWorker, ToWorker } from './messages.ts';

let engine: LocalEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const post = (msg: FromWorker): void => postMessage(msg);

onmessage = (event: MessageEvent<ToWorker>): void => {
  const msg = event.data;
  switch (msg.t) {
    case 'start': {
      if (timer !== null) clearInterval(timer);
      const created = createLocalEngine(msg.map, msg.seed, msg.players);
      if ('errors' in created) {
        post({ t: 'error', errors: created.errors });
        return;
      }
      engine = created;
      timer = setInterval(() => {
        if (engine) post(engine.tick());
      }, TICK_MS);
      return;
    }
    case 'command':
      engine?.queue(msg.cmd);
      return;
    case 'select':
      engine?.select(msg.hex);
      return;
  }
};
