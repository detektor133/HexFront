// Запуск сервера. Настройки — переменные окружения:
//   PORT (8080), HOST (127.0.0.1: наружу смотрит только Caddy), ALLOWED_ORIGINS (через запятую),
//   TRUST_PROXY=1 (адрес клиента из X-Forwarded-For), MAX_ROOMS (12).
// Логи — JSON-строки в stdout.
import { Hub } from './hub.ts';
import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? 8080);
const origins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');
const hub = new Hub({
  maxRooms: Number(process.env.MAX_ROOMS ?? 12),
  log(event, data) {
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`);
  },
});
const server = await startServer(hub, port, {
  host: process.env.HOST ?? '127.0.0.1',
  allowedOrigins: origins,
  trustProxy: process.env.TRUST_PROXY === '1',
});
hub.log('listening', { port: server.port, origins: origins.length });

const stop = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
