// Точка входа воркера-шарда: хост комнат, свой планировщик тиков и пачки исходящего.
// Сокеты сюда не попадают: шлюз в I/O-потоке присылает проверенные сообщения по числовому `conn`.
import { parentPort, workerData } from 'node:worker_threads';

import { cachedMap } from './maps.ts';
import { RoomHost } from './room-host.ts';
import type { FromShard, HostSettings, ToShard } from './shard-protocol.ts';

const port = parentPort;
if (port === null) throw new Error('shard-worker запускается только как воркер');
const settings = (workerData as { settings: HostSettings }).settings;

const post = (message: FromShard): void => {
  port.postMessage(message);
};

let outBatch: [number, string][] = [];
let closes: number[] = [];
let flushQueued = false;

/** Отдаёт накопленное шлюзу одной пачкой. */
const flush = (): void => {
  flushQueued = false;
  if (outBatch.length > 0) {
    const batch = outBatch;
    outBatch = [];
    post({ k: 'out', batch });
  }
  if (closes.length > 0) {
    const conns = closes;
    closes = [];
    post({ k: 'close', conns });
  }
};

const queueFlush = (): void => {
  if (flushQueued) return;
  flushQueued = true;
  setImmediate(flush);
};

const host = new RoomHost({
  ...settings,
  now: Date.now,
  makeMap: cachedMap,
  io: {
    out: (conn, text) => {
      outBatch.push([conn, text]);
    },
    close: (conn) => {
      closes.push(conn);
    },
    // Итог входа уходит сразу и раньше текстов: шлюз успевает привязать соединение к комнате.
    joined: (conn, roomId, ok) => {
      post({ k: 'joined', conn, roomId, ok });
    },
    log: (event, data) => {
      post({ k: 'log', event, ...(data === undefined ? {} : { data }) });
    },
  },
});

port.on('message', (batch: ToShard[]) => {
  for (const message of batch) {
    switch (message.k) {
      case 'create':
        host.create(message.roomId, message.mode, message.seed);
        break;
      case 'join':
        host.join(message.conn, message.roomId, message.nick, message.spectate === true);
        break;
      case 'reconnect':
        host.reconnect(message.conn, message.roomId, message.token, message.have);
        break;
      case 'c2s':
        host.message(message.conn, message.m);
        break;
      case 'closed':
        host.closed(message.conn);
        break;
      case 'stop':
        host.stop();
        process.exit(0);
    }
  }
  queueFlush();
});

host.start(flush, () => {
  post({ k: 'status', status: host.status() });
});
