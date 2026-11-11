// Нагрузочный прогон серверного хаба без сети: N комнат × M людей, клиенты подтверждают каждый вид.
//
// Запуск (из корня репозитория):
//   node --expose-gc --experimental-strip-types tools/bench/src/room-load.ts [опции]
// Опции: --rooms=N (по умолчанию 4)  --humans=M (30)  --minutes=T (3, минут игры, ускоренно)
// Печатает по минуте: мс на тик хаба (все комнаты), p50/p99, байты на игрока в секунду, память.
import { deflateRawSync } from 'node:zlib';

import { Hub } from '../../../apps/server/src/hub.ts';
import { PROTOCOL_VERSION, encodeClientMessage } from '../../../packages/protocol/src/index.ts';

const option = (name: string, fallback: string): string => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ROOMS = Number(option('rooms', '4'));
const HUMANS = Number(option('humans', '30'));
const MINUTES = Number(option('minutes', '3'));
const TICKS_PER_MINUTE = 600;
/** Сжимаем каждое десятое сообщение: оценка трафика после deflate без искажения времени тика. */
const DEFLATE_EVERY = 10;

let clock = 0;
const hub = new Hub({ now: () => clock, size: 30 });

interface Bot {
  session: ReturnType<Hub['connect']>;
  bytes: number;
  deflated: number;
  count: number;
}
const bots: Bot[] = [];

for (let room = 0; room < ROOMS; room += 1) {
  let code = '';
  for (let i = 0; i < HUMANS; i += 1) {
    const bot: Bot = { session: null as never, bytes: 0, deflated: 0, count: 0 };
    bot.session = hub.connect({
      send(text) {
        bot.bytes += text.length;
        bot.count += 1;
        if (bot.count % DEFLATE_EVERY === 0) bot.deflated += deflateRawSync(text).length;
        // Клиент применил сообщение вида и подтверждает его.
        const head = text.slice(0, 40);
        if (head.includes('"t":"snapshot"') || head.includes('"t":"delta"')) {
          const tick = /"tick":(\d+)/.exec(text.slice(0, 200));
          if (tick)
            bot.session.onMessage(encodeClientMessage({ t: 'viewAck', tick: Number(tick[1]) }));
        }
        if (i === 0 && text.includes('"t":"welcome"')) {
          code = (JSON.parse(text) as { room: string }).room;
        }
      },
      close() {},
    });
    bot.session.onMessage(
      encodeClientMessage({
        t: 'hello',
        v: PROTOCOL_VERSION,
        nick: `Игрок${room}_${i}`,
        mode: 'private',
        ...(i === 0 ? {} : { room: code }),
      }),
    );
    bots.push(bot);
  }
  (bots[room * HUMANS] as Bot).session.onMessage(encodeClientMessage({ t: 'start' }));
}

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};

console.log(`комнат ${ROOMS} × людей ${HUMANS}, ${MINUTES} мин игры`);
for (let minute = 1; minute <= MINUTES; minute += 1) {
  const samples: number[] = [];
  const bytesBefore = bots.reduce((sum, b) => sum + b.bytes, 0);
  const deflatedBefore = bots.reduce((sum, b) => sum + b.deflated, 0);
  for (let tick = 0; tick < TICKS_PER_MINUTE; tick += 1) {
    clock += 100;
    const started = performance.now();
    hub.tickAll();
    samples.push(performance.now() - started);
  }
  (globalThis as { gc?: () => void }).gc?.();
  const bytes = bots.reduce((sum, b) => sum + b.bytes, 0) - bytesBefore;
  const deflated = bots.reduce((sum, b) => sum + b.deflated, 0) - deflatedBefore;
  const seconds = TICKS_PER_MINUTE / 10;
  const perPlayer = bytes / (ROOMS * HUMANS) / seconds;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(
    `мин ${minute}: тик хаба ср ${mean.toFixed(1)} p50 ${percentile(samples, 0.5).toFixed(1)} ` +
      `p99 ${percentile(samples, 0.99).toFixed(1)} макс ${Math.max(...samples).toFixed(1)} мс; ` +
      `на комнату ${(mean / ROOMS).toFixed(1)} мс; трафик ${(perPlayer / 1024).toFixed(2)} КБ/с на игрока ` +
      `(deflate ≈ ${((deflated * DEFLATE_EVERY) / (ROOMS * HUMANS) / seconds / 1024).toFixed(2)}); ` +
      `куча ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} МБ`,
  );
}
hub.stop();
