import { afterEach, describe, expect, it } from 'vitest';

import { encodeClientMessage, PROTOCOL_VERSION, type C2S } from '@hexfront/protocol';

import { Hub, type Session } from '../src/hub.ts';

/** Клиент в памяти поверх настоящих воркеров: ответы приходят асинхронно. */
class Client {
  public readonly raw: string[] = [];
  public closed = false;
  public readonly session: Session;

  public constructor(hub: Hub, ip: string) {
    const session = hub.connect(
      {
        send: (text) => this.raw.push(text),
        close: () => {
          this.closed = true;
        },
      },
      ip,
    );
    if (session === null) throw new Error('соединение отклонено');
    this.session = session;
  }

  public send(message: C2S): void {
    this.session.onMessage(encodeClientMessage(message));
  }

  public hello(nick: string, extra: Partial<Extract<C2S, { t: 'hello' }>> = {}): void {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, nick, ...extra });
  }

  public count(prefix: string): number {
    return this.raw.filter((text) => text.startsWith(`{"t":"${prefix}"`)).length;
  }

  public first<T>(prefix: string): T | undefined {
    const text = this.raw.find((item) => item.startsWith(`{"t":"${prefix}"`));
    return text === undefined ? undefined : (JSON.parse(text) as T);
  }
}

async function until(check: () => boolean, what: string, ms = 20_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`не дождались: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let hub: Hub | null = null;
afterEach(() => {
  hub?.stop();
  hub = null;
});

const newHub = (workers = 2, lateJoinSeconds = 240): Hub => {
  hub = new Hub({ workers, size: 6, budgetMs: 200, lateJoinSeconds });
  hub.start();
  return hub;
};

describe('шарды в воркерах', () => {
  it('матч целиком идёт в воркере: вход, старт, снимок, дельты, команда, ack', async () => {
    const h = newHub(2);
    const a = new Client(h, 'ip-a');
    a.hello('Аня', { mode: 'private' });
    await until(() => a.count('welcome') > 0, 'welcome');
    a.send({ t: 'start' });
    await until(() => a.count('snapshot') > 0, 'снимок');
    const snapshot = a.first<{ tick: number }>('snapshot');
    a.send({ t: 'viewAck', tick: snapshot?.tick ?? 0 });
    await until(() => a.count('delta') > 2, 'дельты');
    a.send({ t: 'cmd', seq: 1, cmd: { t: 'setTax', rate: 300 } as never });
    await until(() => a.count('ack') > 0, 'ack команды');
    expect(h.stats().humans).toBe(1);
  });

  it('комнаты распределяются по шардам по цене, а не копятся в одном', async () => {
    const h = newHub(2);
    const clients = [new Client(h, 'ip-1'), new Client(h, 'ip-2'), new Client(h, 'ip-3')];
    clients.forEach((c, i) => c.hello(`Игрок${i}`, { mode: 'private' }));
    await until(() => clients.every((c) => c.count('welcome') > 0), 'три входа');
    await until(() => h.stats().shards.every((s) => s.rooms >= 1), 'сводки шардов');
    const rooms = h.stats().shards.map((s) => s.rooms);
    expect(rooms.reduce((a, b) => a + b, 0)).toBe(3);
    // 3 комнаты на 2 шарда: самое неравномерное разбиение 2 + 1, не 3 + 0.
    expect(Math.max(...rooms)).toBe(2);
  });

  it('реконнект по токену попадает в нужный воркер и продолжает дельтами', async () => {
    const h = newHub(2);
    const a = new Client(h, 'ip-a');
    a.hello('Аня', { mode: 'private' });
    await until(() => a.count('welcome') > 0, 'welcome');
    const welcome = a.first<{ token: string }>('welcome');
    a.send({ t: 'start' });
    await until(() => a.count('snapshot') > 0, 'снимок');
    const tick = a.first<{ tick: number }>('snapshot')?.tick ?? 0;
    a.send({ t: 'viewAck', tick });
    await until(() => a.count('delta') > 1, 'дельты');
    a.session.onClose();

    const back = new Client(h, 'ip-a2');
    back.hello('Аня', { token: welcome?.token ?? '', have: tick });
    await until(() => back.count('welcome') > 0, 'welcome после реконнекта');
    await until(() => back.count('delta') + back.count('snapshot') > 0, 'вид после реконнекта');
    expect(back.count('snapshot')).toBe(0);
    expect(back.count('delta')).toBeGreaterThan(0);
  });

  it('вход в открытый набор: второй игрок попадает в ту же комнату, а не в новую', async () => {
    const h = newHub(2);
    const b = new Client(h, 'ip-b');
    b.hello('Борис');
    await until(() => b.count('welcome') > 0, 'welcome открытой комнаты');
    expect(b.first<{ playerId: number }>('welcome')?.playerId).toBe(0);
    const c = new Client(h, 'ip-c');
    c.hello('Вика');
    await until(() => c.count('welcome') > 0, 'welcome второго игрока');
    expect(c.first<{ room: string }>('welcome')?.room).toBe(
      b.first<{ room: string }>('welcome')?.room,
    );
  });

  it('падение воркера: игроки отключаются, шард поднимается заново, новые входы работают', async () => {
    const h = newHub(2);
    const a = new Client(h, 'ip-a');
    a.hello('Аня', { mode: 'private' });
    await until(() => a.count('welcome') > 0, 'welcome');
    // Внутренности шарда трогаем только в этом тесте: нужен его поток, чтобы «уронить» его.
    const shards = (
      h as unknown as {
        shards: { status(): { rooms: unknown[] }; worker: { terminate(): void } }[];
      }
    ).shards;
    const owner = shards.find((shard) => shard.status().rooms.length > 0);
    expect(owner).toBeTruthy();
    void owner?.worker.terminate();
    await until(() => a.closed, 'отключение игрока при падении шарда');

    const b = new Client(h, 'ip-b');
    b.hello('Борис', { mode: 'private' });
    await until(() => b.count('welcome') > 0, 'вход после восстановления шарда', 30_000);
    expect(h.stats().shards).toHaveLength(2);
  });
});
