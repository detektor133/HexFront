// Упаковка комнат при потоке входящих игроков: сколько комнат и какая цена тика получаются, если
// новый человек приходит раз в N секунд, с подсадкой на место бота и без неё.
//
// Запуск (из корня репозитория):
//   node --expose-gc --experimental-strip-types tools/bench/src/arrivals.ts [--every=9 --minutes=6 --late=240]
// --late=0 выключает подсадку. Время виртуальное: тики идут без ожидания.
import { Hub } from '../../../apps/server/src/hub.ts';
import { encodeClientMessage, PROTOCOL_VERSION } from '../../../packages/protocol/src/index.ts';

const option = (name: string, fallback: string): string => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const EVERY_S = Number(option('every', '9'));
const MINUTES = Number(option('minutes', '6'));
const LATE_S = Number(option('late', '240'));

let clock = 0;
const hub = new Hub({
  now: () => clock,
  maxRooms: 1000,
  budgetMs: 1e9,
  lateJoinSeconds: LATE_S,
});

let arrived = 0;
let refused = 0;
const arrive = (): void => {
  arrived += 1;
  const session = hub.connect(
    {
      send(text) {
        if (text.includes('"refused"')) refused += 1;
      },
      close() {},
    },
    `ip${arrived}`,
  );
  session?.onMessage(
    encodeClientMessage({ t: 'hello', v: PROTOCOL_VERSION, nick: `Игрок${arrived}` }),
  );
};

console.log(
  `приход раз в ${EVERY_S} с, ${MINUTES} мин, подсадка ${LATE_S === 0 ? 'выкл' : `${LATE_S} с`}`,
);
const ticks = MINUTES * 600;
const samples: number[] = [];
for (let tick = 1; tick <= ticks; tick += 1) {
  clock += 100;
  if (tick % (EVERY_S * 10) === 0) arrive();
  const started = performance.now();
  hub.tickAll();
  samples.push(performance.now() - started);
  if (tick % 600 === 0) {
    const stats = hub.stats();
    const recent = samples.slice(-600).sort((a, b) => a - b);
    console.log(
      `мин ${tick / 600}: онлайн ${stats.humans}, комнат ${stats.rooms}, ` +
        `людей на комнату ${(stats.humans / Math.max(1, stats.rooms)).toFixed(1)}, ` +
        `тик хаба p50 ${recent[Math.floor(recent.length / 2)]?.toFixed(1)} p99 ${recent[Math.floor(recent.length * 0.99)]?.toFixed(1)} мс, ` +
        `прогноз цены ${stats.projectedMs} мс`,
    );
  }
}
console.log(`пришло ${arrived}, отказов ${refused}`);
