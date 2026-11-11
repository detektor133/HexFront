// Запуск сервера: PORT (по умолчанию 8080), логи — JSON-строки в stdout.
import { Hub } from './hub.ts';
import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? 8080);
const hub = new Hub({
  log(event, data) {
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`);
  },
});
const server = await startServer(hub, port);
hub.log('listening', { port: server.port });

const stop = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
