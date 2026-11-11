// Из чего складывается тик комнаты на сервере: боты и командиры, шаг sim, виды и отправка игрокам.
//
// Запуск (из корня репозитория):
//   node --expose-gc --experimental-strip-types tools/bench/src/tick-split.ts [--humans=3 --minutes=10]
// Один хост, одна комната, люди молчат (только подтверждают виды), остальные места — боты.
import { Session } from 'node:inspector';

import { cachedMap } from '../../../apps/server/src/maps.ts';
import { RoomHost } from '../../../apps/server/src/room-host.ts';
import { encodeClientMessage, PROTOCOL_VERSION } from '../../../packages/protocol/src/index.ts';

const option = (name: string, fallback: string): string => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const HUMANS = Number(option('humans', '3'));
const MINUTES = Number(option('minutes', '10'));
/** С какой минуты снимать профиль процессора (0 — не снимать); профиль печатает главные функции. */
const PROFILE_FROM = Number(option('profile', '0'));
const session = new Session();
const post = <T>(method: string, params?: object): Promise<T> =>
  new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => (error ? reject(error) : resolve(result as T)));
  });
void encodeClientMessage;
void PROTOCOL_VERSION;

let clock = 0;
let bytes = 0;
const host = new RoomHost({
  size: 30,
  fog: true,
  budgetMs: 65,
  roomEstimateMs: 8,
  lateJoinTicks: 0,
  seeds: [],
  now: () => clock,
  makeMap: cachedMap,
  io: {
    out: (conn, text) => {
      bytes += text.length;
      const head = text.slice(0, 20);
      if (head.startsWith('{"t":"snapshot"') || head.startsWith('{"t":"delta"')) {
        const tick = /"tick":(\d+)/.exec(text.slice(0, 200));
        if (tick) host.message(conn, { t: 'viewAck', tick: Number(tick[1]) });
      }
    },
    close: () => undefined,
    joined: () => undefined,
    log: () => undefined,
  },
});
host.create('r', 'private', 43);
for (let i = 0; i < HUMANS; i += 1) host.join(i + 1, 'r', `Игрок${i}`);
host.message(1, { t: 'start' });

const room = host.room('r');
if (room === undefined) throw new Error('нет комнаты');
console.log(`люди ${HUMANS}, ботов ${30 - HUMANS}`);
if (PROFILE_FROM > 0) {
  session.connect();
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 200 });
}
for (let minute = 1; minute <= MINUTES; minute += 1) {
  if (minute === PROFILE_FROM) await post('Profiler.start');
  let bots = 0;
  let step = 0;
  let views = 0;
  bytes = 0;
  for (let tick = 0; tick < 600; tick += 1) {
    clock += 100;
    host.tick();
    const last = room.stats.last;
    bots += last.botsMs;
    step += last.stepMs;
    views += last.viewMs;
  }
  (globalThis as { gc?: () => void }).gc?.();
  console.log(
    `мин ${minute}: боты+командиры ${(bots / 600).toFixed(2)} мс, шаг sim ${(step / 600).toFixed(2)} мс, ` +
      `виды и отправка ${(views / 600).toFixed(2)} мс; всего ${((bots + step + views) / 600).toFixed(2)} мс/тик; ` +
      `${(bytes / HUMANS / 60 / 1024).toFixed(2)} КБ/с на игрока; куча ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} МБ`,
  );
}

if (PROFILE_FROM > 0) {
  const { profile } = await post<{
    profile: {
      nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[];
      samples: number[];
      timeDeltas: number[];
    };
  }>('Profiler.stop');
  const self = new Map<number, number>();
  profile.samples.forEach((id, index) => {
    self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0));
  });
  const byName = new Map<string, number>();
  for (const node of profile.nodes) {
    const name = `${node.callFrame.functionName || '(анонимная)'} ${node.callFrame.url.split('/').slice(-2).join('/')}:${node.callFrame.lineNumber + 1}`;
    byName.set(name, (byName.get(name) ?? 0) + (self.get(node.id) ?? 0));
  }
  const total = [...byName.values()].reduce((a, b) => a + b, 0);
  for (const [name, time] of [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) {
    console.log(`${((time / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
  }
}
