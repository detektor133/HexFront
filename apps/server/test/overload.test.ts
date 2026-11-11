import { afterEach, describe, expect, it } from 'vitest';

import { encodeClientMessage, PROTOCOL_VERSION } from '@hexfront/protocol';
import { loadMap } from '@hexfront/sim';

import small from '../../../packages/mapgen/maps/small.json' with { type: 'json' };
import { Hub } from '../src/hub.ts';
import { RoomHost } from '../src/room-host.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));

const MAP = loaded.map;

const settings = {
  size: 6,
  fog: true,
  budgetMs: 65,
  roomEstimateMs: 8,
  lateJoinTicks: 0,
  seeds: [] as number[],
};

const burn = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // занимаем поток: имитация комнаты, чей тик дольше 100 мс
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let host: RoomHost | null = null;
let hub: Hub | null = null;
afterEach(() => {
  host?.stop();
  hub?.stop();
  host = null;
  hub = null;
});

function newHost(): RoomHost {
  host = new RoomHost({
    ...settings,
    now: Date.now,
    makeMap: () => MAP,
    io: {
      out: () => undefined,
      close: () => undefined,
      joined: () => undefined,
      log: () => undefined,
    },
  });
  return host;
}

describe('перегруз: комната дольше 100 мс на тик', () => {
  it('тяжёлая комната не вешает соседей и не копит лавину догоняющих тиков; шард помечается перегруженным', async () => {
    const h = newHost();
    h.create('heavy', 'private', 1);
    h.create('light', 'private', 2);
    h.join(1, 'heavy', 'Тяжёлый');
    h.join(2, 'light', 'Лёгкий');
    h.message(1, { t: 'start' });
    h.message(2, { t: 'start' });
    const heavy = h.room('heavy');
    const light = h.room('light');
    if (!heavy || !light) throw new Error('комнаты не созданы');
    (heavy as { tick: () => void }).tick = () => {
      burn(150);
    };
    h.start();
    await sleep(2500);

    const status = h.status();
    expect(status.overloaded).toBe(true);
    expect(status.droppedTicks).toBeGreaterThan(0);
    expect(status.lateMs.p99).toBeGreaterThan(50);
    // Сосед получает свою долю времени: тик не реже, чем раз за два тяжёлых тика.
    expect(light.stats.ticks).toBeGreaterThanOrEqual(6);
  });

  it('фазы комнат разнесены: комнаты, созданные в разное время, тикают не в один миг', async () => {
    const h = newHost();
    // Расписание запущено до создания комнат, как в воркере: у каждой комнаты свой фазовый сдвиг.
    h.start();
    const firstTicks: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      h.create(`r${i}`, 'private', i + 1);
      h.join(i + 1, `r${i}`, `Игрок${i}`);
      h.message(i + 1, { t: 'start' });
      const room = h.room(`r${i}`);
      if (!room) throw new Error('нет комнаты');
      const original = room.tick.bind(room);
      let recorded = false;
      (room as { tick: () => void }).tick = () => {
        if (!recorded) {
          recorded = true;
          firstTicks.push(performance.now());
        }
        original();
      };
      await sleep(35);
    }
    await sleep(500);
    expect(firstTicks).toHaveLength(4);
    const spread = Math.max(...firstTicks) - Math.min(...firstTicks);
    expect(spread).toBeGreaterThan(60);
  });

  it('шлюз не размещает новую комнату на перегруженном шарде и сообщает об этом в stats', async () => {
    hub = new Hub({ size: 6, makeMap: () => MAP, budgetMs: 1000 });
    hub.start();
    const replies: string[] = [];
    const connect = (ip: string) =>
      hub?.connect({ send: (text) => replies.push(text), close: () => undefined }, ip);
    const a = connect('ip-a');
    a?.onMessage(
      encodeClientMessage({ t: 'hello', v: PROTOCOL_VERSION, nick: 'Аня', mode: 'private' }),
    );
    const welcome = JSON.parse(replies.find((r) => r.startsWith('{"t":"welcome"')) ?? '{}') as {
      room?: string;
    };
    const room = hub.roomById(welcome.room ?? '');
    if (!room) throw new Error('комната не создана');
    a?.onMessage(encodeClientMessage({ t: 'start' }));
    (room as { tick: () => void }).tick = () => {
      burn(150);
    };
    await sleep(2500);
    expect(hub.stats().overloaded).toBe(true);

    replies.length = 0;
    const b = connect('ip-b');
    b?.onMessage(
      encodeClientMessage({ t: 'hello', v: PROTOCOL_VERSION, nick: 'Борис', mode: 'private' }),
    );
    expect(replies.some((r) => r.includes('"busy"'))).toBe(true);
  });
});
