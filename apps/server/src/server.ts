// HTTP + WebSocket на одном порту: `/healthz` для проверок и ws для игроков.
import { createServer, type Server } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import { MAX_CLIENT_MESSAGE_BYTES } from '@hexfront/protocol';

import type { Hub } from './hub.ts';

/** Соединение, у которого не накопится больше этого в очереди отправки, байт: медленных отключаем. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export interface RunningServer {
  readonly http: Server;
  readonly hub: Hub;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Запускает сервер на порту (0 — свободный).
 * @returns запущенный сервер; `close` останавливает тики и соединения
 */
export async function startServer(hub: Hub, port: number, host?: string): Promise<RunningServer> {
  const http = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, ...hub.stats() }));
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server: http, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
  sockets.on('connection', (socket: WebSocket) => {
    const session = hub.connect({
      send(text) {
        if (socket.readyState !== socket.OPEN) return;
        if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
          socket.terminate();
          return;
        }
        socket.send(text);
      },
      close() {
        socket.close();
      },
    });
    socket.on('message', (data) => {
      session.onMessage(data.toString());
    });
    socket.on('close', () => {
      session.onClose();
    });
    socket.on('error', () => {
      session.onClose();
    });
  });
  hub.start();
  await new Promise<void>((resolve) => http.listen(port, host, resolve));
  const address = http.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  return {
    http,
    hub,
    port: bound,
    close() {
      hub.stop();
      for (const client of sockets.clients) client.terminate();
      return new Promise<void>((resolve) => {
        sockets.close(() => {
          http.close(() => {
            resolve();
          });
        });
      });
    },
  };
}
