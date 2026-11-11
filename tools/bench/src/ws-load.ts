// Нагрузочный прогон по настоящим сокетам: сервер — отдельный процесс, клиенты — ws из этого процесса.
//
// Запуск (из корня репозитория):
//   node --experimental-strip-types tools/bench/src/ws-load.ts [--rooms=4 --humans=3 --seconds=60]
// Печатает: сколько сообщений и байт получил игрок, паузы между видами (p50/p99/макс), время тика
// хаба и процессор сервера по /healthz. Адреса клиентов подменяются заголовком X-Forwarded-For
// (сервер запускается с TRUST_PROXY=1), иначе сработал бы лимит соединений с одного адреса.
import { spawn } from 'node:child_process';

import { WebSocket } from 'ws';

import { PROTOCOL_VERSION } from '../../../packages/protocol/src/index.ts';

const option = (name: string, fallback: string): string => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ROOMS = Number(option('rooms', '4'));
const HUMANS = Number(option('humans', '3'));
const SECONDS = Number(option('seconds', '60'));
const PORT = 18_181;

const server = spawn(
  process.execPath, // Те же ограничения V8, что в deploy/setup.sh (systemd-сервис).
  [
    '--max-semi-space-size=2',
    '--max-old-space-size=160',
    '--experimental-strip-types',
    'apps/server/src/main.ts',
  ],
  {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      TRUST_PROXY: '1',
      MAX_ROOMS: '100',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
let ready = false;
server.stdout.on('data', (chunk: Buffer) => {
  if (chunk.toString().includes('listening')) ready = true;
});
for (let i = 0; i < 100 && !ready; i += 1) await new Promise((r) => setTimeout(r, 100));
if (!ready) throw new Error('сервер не запустился');

interface Stat {
  views: number;
  bytes: number;
  gaps: number[];
  last: number;
}
const stats: Stat[] = [];

function client(room: number, index: number, code: string | null): Promise<string> {
  return new Promise((resolve) => {
    const stat: Stat = { views: 0, bytes: 0, gaps: [], last: 0 };
    stats.push(stat);
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, {
      headers: { 'x-forwarded-for': `10.${room}.${index}.1` },
    });
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          nick: `Игрок${room}_${index}`,
          ...(code === null ? { mode: 'private' } : { room: code }),
        }),
      );
    });
    ws.on('message', (data) => {
      const text = data.toString();
      stat.bytes += text.length;
      if (text.startsWith('{"t":"welcome"')) resolve((JSON.parse(text) as { room: string }).room);
      if (text.startsWith('{"t":"snapshot"') || text.startsWith('{"t":"delta"')) {
        const tick = /"tick":(\d+)/.exec(text.slice(0, 120));
        ws.send(`{"t":"viewAck","tick":${tick?.[1] ?? 0}}`);
        const now = performance.now();
        if (stat.last > 0) stat.gaps.push(now - stat.last);
        stat.last = now;
        stat.views += 1;
      }
    });
    (client as unknown as { sockets: WebSocket[] }).sockets ??= [];
    (client as unknown as { sockets: WebSocket[] }).sockets.push(ws);
  });
}

const starters: (() => void)[] = [];
for (let room = 0; room < ROOMS; room += 1) {
  const code = await client(room, 0, null);
  const hostSocket = (client as unknown as { sockets: WebSocket[] }).sockets.at(-1);
  starters.push(() => hostSocket?.send('{"t":"start"}'));
  for (let i = 1; i < HUMANS; i += 1) await client(room, i, code);
}
for (const start of starters) start();
console.log(`комнат ${ROOMS} × людей ${HUMANS}, ${SECONDS} с по настоящим сокетам`);
await new Promise((r) => setTimeout(r, SECONDS * 1000));

const health = (await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json()) as {
  rooms: number;
  humans: number;
  tickMs: { p50: number; p99: number; max: number };
  cpuMs: number;
  rssMb: number;
};
const gaps = stats.flatMap((s) => s.gaps).sort((a, b) => a - b);
const at = (p: number): number => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0;
const bytes = stats.reduce((sum, s) => sum + s.bytes, 0);
const views = stats.reduce((sum, s) => sum + s.views, 0);
console.log(
  `игрок: ${(views / stats.length / SECONDS).toFixed(1)} видов/с, ${(bytes / stats.length / SECONDS / 1024).toFixed(2)} КБ/с; ` +
    `пауза между видами p50 ${at(0.5).toFixed(0)} p99 ${at(0.99).toFixed(0)} макс ${gaps.at(-1)?.toFixed(0) ?? 0} мс`,
);
console.log(
  `сервер: комнат ${health.rooms}, людей ${health.humans}; тик хаба p50 ${health.tickMs.p50.toFixed(1)} p99 ${health.tickMs.p99.toFixed(1)} макс ${health.tickMs.max.toFixed(1)} мс; ` +
    `процессор ${((health.cpuMs / 1000 / SECONDS) * 100).toFixed(0)}% одного ядра за прогон; память ${health.rssMb} МБ`,
);
for (const ws of (client as unknown as { sockets: WebSocket[] }).sockets) ws.close();
server.kill();
process.exit(0);
