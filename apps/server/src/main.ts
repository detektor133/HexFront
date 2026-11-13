// Запуск сервера. Настройки — переменные окружения:
//   PORT (8080), HOST (127.0.0.1: наружу смотрит только Caddy), ALLOWED_ORIGINS (через запятую),
//   TRUST_PROXY=1 (адрес клиента из X-Forwarded-For), WS_DEFLATE=1 (сжатие сообщений),
//   SHARDS (число воркеров-шардов, по умолчанию число ядер; 0 — комнаты в потоке шлюза),
//   SHARD_HEAP_MB (192), MAX_ROOMS (24), TICK_BUDGET_MS (65, на шард),
//   LATE_JOIN_SECONDS (240; 0 — не подсаживать в идущие игры).
// Логи — JSON-строки в stdout.
import { availableParallelism } from 'node:os';

import { Hub } from './hub.ts';
import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? 8080);
const origins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');
const workers = Number(process.env.SHARDS ?? availableParallelism());
const hub = new Hub({
  workers,
  shardHeapMb: Number(process.env.SHARD_HEAP_MB ?? 192),
  maxRooms: Number(process.env.MAX_ROOMS ?? 24),
  budgetMs: Number(process.env.TICK_BUDGET_MS ?? 65),
  lateJoinSeconds: Number(process.env.LATE_JOIN_SECONDS ?? 240),
  placeSeconds: Number(process.env.PLACE_SECONDS ?? 0),
  log(event, data) {
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`);
  },
});
const server = await startServer(hub, port, {
  host: process.env.HOST ?? '127.0.0.1',
  allowedOrigins: origins,
  trustProxy: process.env.TRUST_PROXY === '1',
  compress: process.env.WS_DEFLATE === '1',
});
hub.log('listening', { port: server.port, origins: origins.length, shards: Math.max(1, workers) });

const stop = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGUSR2', () => {
  hub.drain();
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
