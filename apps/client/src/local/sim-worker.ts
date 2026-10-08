// Web Worker локального режима: раз в 100 мс — speed тиков sim, снимок игроку после последнего.
import { TICK_MS } from '@hexfront/sim';

import { createLocalEngine, type LocalEngine } from './engine.ts';
import type { FromWorker, ToWorker, ViewPayload } from './messages.ts';
import { ConfirmedViewDeltaStream } from './view-delta.ts';

let engine: LocalEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let paused = false;
let speed = 1;
let awaitingAck = false;
let snapshotSeq = 0;
let tickMs: number[] = [];
let lastSnapshotAt = 0;
let lastAckMs: number | null = null;
const deltaStream = new ConfirmedViewDeltaStream();

const post = (msg: FromWorker): void => postMessage(msg);
const emitSnapshot = (): void => {
  if (!engine || awaitingAck) return;
  awaitingAck = true;
  snapshotSeq += 1;
  const snapshot: ViewPayload = { ...engine.snapshot(), seq: snapshotSeq };
  const transport = deltaStream.next(snapshot.view, snapshot.events);
  if (transport === null) return;
  const snapshotPayload = {
    t: snapshot.t,
    seq: snapshot.seq,
    selection: snapshot.selection,
    rejected: snapshot.rejected,
    events: snapshot.events,
  };
  const total = tickMs.reduce((sum, value) => sum + value, 0);
  const telemetryBase = {
    tickMsAvg: tickMs.length === 0 ? 0 : total / tickMs.length,
    tickMsMax: tickMs.length === 0 ? 0 : Math.max(...tickMs),
    snapshotBytes: 0,
    ackMs: lastAckMs,
  };
  const snapshotBytes = new TextEncoder().encode(
    JSON.stringify({ ...snapshotPayload, ...transport, telemetry: telemetryBase }),
  ).byteLength;
  const telemetry = { ...telemetryBase, snapshotBytes };
  tickMs = [];
  lastSnapshotAt = performance.now();
  post({ ...snapshotPayload, ...transport, telemetry } as FromWorker);
};

const advance = (): void => {
  if (!engine) return;
  const started = performance.now();
  engine.advance();
  tickMs.push(performance.now() - started);
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
      tickMs = [];
      lastAckMs = null;
      deltaStream.reset();
      emitSnapshot();
      timer = setInterval(() => {
        if (!engine || paused) return;
        for (let i = 0; i < speed && engine.state.winner < 0; i += 1) advance();
        emitSnapshot();
      }, TICK_MS);
      return;
    }
    case 'command':
      engine?.queue(msg.cmd);
      return;
    case 'fog':
      engine?.setFog(msg.on);
      deltaStream.requestFull();
      emitSnapshot();
      return;
    case 'pause':
      paused = msg.on;
      return;
    case 'step':
      advance();
      emitSnapshot();
      return;
    case 'speed':
      speed = Math.max(1, Math.floor(msg.value));
      return;
    case 'observer':
      engine?.setObserver(msg.playerId);
      deltaStream.requestFull();
      emitSnapshot();
      return;
    case 'view':
      engine?.setView(msg.playerId, msg.fog);
      deltaStream.requestFull();
      emitSnapshot();
      return;
    case 'select':
      engine?.select(msg.hex);
      return;
    case 'ack':
      if (msg.seq !== snapshotSeq) return;
      lastAckMs = performance.now() - lastSnapshotAt;
      deltaStream.acknowledge();
      awaitingAck = false;
      emitSnapshot();
      return;
  }
};
