// HTTP + WebSocket на одном порту: `/healthz` для проверок и ws для игроков.
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import { MAX_CLIENT_MESSAGE_BYTES } from '@hexfront/protocol';

import type { Hub } from './hub.ts';

/** Соединение, у которого накопилось больше этого в очереди отправки, байт, обрывается как медленное. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** Период проверки живости: ping по ws, не ответившие за период — обрываются. */
export const HEARTBEAT_MS = 10_000;

export interface ServerOptions {
  readonly host?: string;
  /** Разрешённые `Origin` страницы; пусто — любые (разработка). Чужие сайты не смогут играть от имени игрока. */
  readonly allowedOrigins?: readonly string[];
  /** Сервер стоит за обратным прокси (Caddy): адрес клиента берётся из `X-Forwarded-For`. */
  readonly trustProxy?: boolean;
}

export interface RunningServer {
  readonly http: Server;
  readonly hub: Hub;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Подходит ли `Origin` под список: точное совпадение или шаблон `https://*.example.com`
 * (любой поддомен одного уровня и глубже; сам `example.com` шаблоном не покрывается).
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  if (origin === undefined) return false;
  return allowed.some((rule) => {
    const star = rule.indexOf('*.');
    if (star < 0) return rule === origin;
    const prefix = rule.slice(0, star);
    const suffix = rule.slice(star + 1);
    return (
      origin.startsWith(prefix) &&
      origin.endsWith(suffix) &&
      origin.length > prefix.length + suffix.length
    );
  });
}

function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return request.socket.remoteAddress ?? 'unknown';
}

/**
 * Запускает сервер на порту (0 — свободный).
 * @returns запущенный сервер; `close` останавливает тики и соединения
 */
export async function startServer(
  hub: Hub,
  port: number,
  options: ServerOptions = {},
): Promise<RunningServer> {
  const allowed = options.allowedOrigins ?? [];
  const http = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, ...hub.stats() }));
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server: http, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();
  sockets.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    if (!originAllowed(request.headers.origin, allowed)) {
      socket.close(1008, 'origin');
      return;
    }
    const session = hub.connect(
      {
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
      },
      clientIp(request, options.trustProxy ?? false),
    );
    if (session === null) return;
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    socket.on('message', (data) => {
      alive.set(socket, true);
      session.onMessage(data.toString());
    });
    socket.on('close', () => {
      session.onClose();
    });
    socket.on('error', () => {
      session.onClose();
    });
  });
  // Полуоткрытые соединения (пропал телефон, смена сети) ловим пингом: место держит 30 с реконнекта.
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, HEARTBEAT_MS);
  hub.start();
  await new Promise<void>((resolve) => http.listen(port, options.host, resolve));
  const address = http.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  return {
    http,
    hub,
    port: bound,
    close() {
      clearInterval(heartbeat);
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
