// Web Worker локального режима: раз в 100 мс — speed тиков sim, снимок игроку после последнего.
import { TICK_MS } from '@hexfront/sim';

import { createLocalEngine, type LocalEngine } from './engine.ts';
import type { FromWorker, ToWorker } from './messages.ts';

let engine: LocalEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let paused = false;
let speed = 1;
let awaitingAck = false;
let snapshotSeq = 0;

const post = (msg: FromWorker): void => postMessage(msg);
const emitSnapshot = (): void => {
  if (!engine || awaitingAck) return;
  awaitingAck = true;
  snapshotSeq += 1;
  post({ ...engine.snapshot(), seq: snapshotSeq });
};

onmessage = (event: MessageEvent<ToWorker>): void => {
  const msg = event.data;
  switch (msg.t) {
    case 'start': {
      if (timer !== null) clearInterval(timer);
      const created = createLocalEngine(msg.map, msg.seed, msg.players, msg.bots, msg.fog);
      if ('errors' in created) {
        post({ t: 'error', errors: created.errors });
        return;
      }
      engine = created;
      paused = msg.speed === 0;
      speed = Math.max(1, Math.floor(msg.speed) || 1);
      awaitingAck = false;
      snapshotSeq = 0;
      snapshotSeq += 1;
      awaitingAck = true;
      post({ ...engine.snapshot(), seq: snapshotSeq });
      timer = setInterval(() => {
        if (!engine || paused) return;
        for (let i = 0; i < speed && engine.state.winner < 0; i += 1) engine.advance();
        emitSnapshot();
      }, TICK_MS);
      return;
    }
    case 'command':
      engine?.queue(msg.cmd);
      return;
    case 'fog':
      engine?.setFog(msg.on);
      return;
    case 'pause':
      paused = msg.on;
      return;
    case 'step':
      engine?.advance();
      emitSnapshot();
      return;
    case 'speed':
      speed = Math.max(1, Math.floor(msg.value));
      return;
    case 'observer':
      engine?.setObserver(msg.playerId);
      emitSnapshot();
      return;
    case 'select':
      engine?.select(msg.hex);
      return;
    case 'ack':
      if (msg.seq !== snapshotSeq) return;
      awaitingAck = false;
      emitSnapshot();
      return;
  }
};
