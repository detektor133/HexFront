// Сквозной тест сети на виртуальном времени: настоящий хаб сервера + настоящий NetClient,
// между ними канал с задержкой, разбросом, обрывами и молчаливой потерей пакетов.
import { describe, expect, it } from 'vitest';

import { Link, World } from './net-harness.ts';
import type { FromWorker } from '../../../apps/client/src/local/messages.ts';
import { ViewDeltaApplier } from '../../../apps/client/src/local/view-delta.ts';
import { NetClient } from '../../../apps/client/src/net/net-client.ts';
import { startOnlineMatch } from '../../../apps/client/src/net/online-match.ts';
import { Hub } from '../../../apps/server/src/hub.ts';
import small from '../../../packages/mapgen/maps/small.json' with { type: 'json' };
import type { Command, MapStatic } from '../../../packages/sim/src/index.ts';
import { loadMap } from '../../../packages/sim/src/index.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const MAP: MapStatic = loaded.map;

function setup(seed = 1) {
  let s = seed;
  const random = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const world = new World();
  const hub = new Hub({ now: () => world.time, size: 6, makeMap: () => MAP });
  const link = new Link(world, hub, random);
  const tickLoop = (): void => {
    hub.tickAll();
    world.after(100, tickLoop);
  };
  world.after(100, tickLoop);
  const events: string[] = [];
  const snapshots: number[] = [];
  let views = 0;
  const client = new NetClient({
    connect: link.connect,
    clock: world.clock,
    nick: 'Тест',
    mode: 'private',
    random,
    handlers: {
      onView: (view, ev, full) => {
        views += 1;
        if (full) snapshots.push(view.tick);
        for (const e of ev) events.push(e.t === 'commandRejected' ? `rejected:${e.reason}` : e.t);
      },
    },
  });
  return { world, hub, link, client, random, events, snapshots, views: () => views };
}

const roomOf = (hub: Hub, client: NetClient) => hub.roomById(client.session?.room ?? '');

describe('сеть: высокий пинг и потери', () => {
  it('при пинге 600 мс и разбросе клиент держится рядом с сервером и получает дельты', () => {
    const { world, hub, link, client, snapshots, views } = setup();
    link.oneWayMs = 300;
    link.jitterMs = 100;
    client.start();
    world.run(2000);
    client.startMatch();
    world.run(40_000);
    const state = roomOf(hub, client)?.state;
    expect(state).toBeTruthy();
    expect(client.status).toBe('online');
    expect(client.view?.tick ?? 0).toBeGreaterThan(30);
    // Отставание ограничено: кругового пинга хватает на 2–3 тика на сообщение, не копится.
    expect((state?.tick ?? 0) - (client.view?.tick ?? 0)).toBeLessThan(40);
    expect(snapshots).toHaveLength(1);
    // Окно отправки держит вид на каждом тике (≈10 Гц) даже при круговой задержке 600 мс.
    expect(views()).toBeGreaterThan(250);
    expect(client.rtt ?? 0).toBeGreaterThan(550);
  });

  it('обрывы каждые 3–6 с: матч продолжается дельтами, команды исполнены ровно один раз', () => {
    const { world, hub, link, client, random, snapshots } = setup(7);
    link.oneWayMs = 80;
    link.jitterMs = 60;
    client.start();
    world.run(1500);
    client.startMatch();
    world.run(1500);
    const names: string[] = [];
    for (let round = 0; round < 8; round += 1) {
      const name = `Армия ${round}`;
      names.push(name);
      client.command({ t: 'createArmy', name } as Command);
      world.run(1000 + Math.floor(random() * 3000));
      link.drop();
      world.run(500 + Math.floor(random() * 2500));
    }
    world.run(15_000);
    expect(client.status).toBe('online');
    expect(client.unacked).toBe(0);
    const state = roomOf(hub, client)?.state;
    const armies = state?.armies.filter((a) => a.owner === 0).map((a) => a.name) ?? [];
    for (const name of names) expect(armies.filter((n) => n === name)).toHaveLength(1);
    // Все обрывы короче 30 с: клиент вернулся по токену и не потерял базу — один полный снимок.
    expect(snapshots.length).toBeLessThanOrEqual(2);
    expect(link.connects).toBeGreaterThan(5);
  });

  it('потерянный ack: команда повторяется после обрыва, но исполняется ровно один раз', () => {
    const { world, hub, link, client } = setup(9);
    link.oneWayMs = 80;
    client.start();
    world.run(1500);
    client.startMatch();
    world.run(1500);
    for (let round = 0; round < 5; round += 1) {
      client.command({ t: 'createArmy', name: `Дубль ${round}` } as Command);
      // Сервер уже принял команду (80 мс), а ack ещё в пути (ещё 80 мс): рвём связь между ними.
      world.run(100);
      link.drop();
      world.run(3000);
    }
    expect(client.unacked).toBe(0);
    const armies = roomOf(hub, client)?.state?.armies.filter((a) => a.owner === 0) ?? [];
    for (let round = 0; round < 5; round += 1) {
      expect(armies.filter((a) => a.name === `Дубль ${round}`)).toHaveLength(1);
    }
  });

  it('молчаливая потеря связи: клиент сам замечает мёртвый канал и возвращается', () => {
    const { world, link, client, hub } = setup(3);
    client.start();
    world.run(1500);
    client.startMatch();
    world.run(5000);
    link.blackhole = true;
    world.run(8000);
    expect(client.status).toBe('reconnecting');
    link.blackhole = false;
    world.run(12_000);
    expect(client.status).toBe('online');
    const room = roomOf(hub, client);
    expect((room?.state?.tick ?? 0) - (client.view?.tick ?? 0)).toBeLessThan(5);
  });

  it('вид клиента совпадает с серверным после восстановления', () => {
    const { world, hub, link, client } = setup(11);
    client.start();
    world.run(1500);
    client.startMatch();
    world.run(6000);
    for (let i = 0; i < 4; i += 1) {
      link.drop();
      world.run(1500);
    }
    world.run(10_000);
    const view = client.view;
    const state = roomOf(hub, client)?.state;
    expect(view && state).toBeTruthy();
    if (!view || !state) return;
    const server = state.hexes.owner;
    // Границы владений — политическая карта, видна всегда: должны совпадать до гекса.
    let diff = 0;
    for (let h = 0; h < server.length; h += 1) if (view.hexes.owner[h] !== server[h]) diff += 1;
    // Допуск на один тик в пути: меняются единичные гексы на фронте.
    expect(diff).toBeLessThan(server.length * 0.01);
  });

  it('читерская команда с чужим отрядом отклоняется сервером, а не исполняется', () => {
    const { world, hub, client, events } = setup(5);
    client.start();
    world.run(1500);
    client.startMatch();
    world.run(3000);
    const state = roomOf(hub, client)?.state;
    const foreign = state?.units.find((u) => u.owner !== 0);
    expect(foreign).toBeTruthy();
    client.command({ t: 'move', unitIds: [foreign?.id ?? -1], to: 0 } as Command);
    world.run(1000);
    expect(events.some((e) => e.startsWith('rejected:'))).toBe(true);
  });
});

describe('сеть: защита сервера', () => {
  it('молчун без hello отключается, флудер отключается, подбор токенов упирается в лимит', () => {
    const { world, hub } = setup(2);
    const closed: string[] = [];
    const silent = hub.connect({ send() {}, close: () => closed.push('silent') }, 'ip-s');
    expect(silent).not.toBeNull();
    world.run(7000);
    expect(closed).toEqual(['silent']);

    const flood = hub.connect({ send() {}, close: () => closed.push('flood') }, 'ip-f');
    for (let i = 0; i < 150; i += 1) flood?.onMessage('{"t":"ping","at":1}');
    expect(closed).toContain('flood');

    let refusedBusy = 0;
    for (let i = 0; i < 40; i += 1) {
      const guess = hub.connect(
        {
          send: (text) => {
            if (text.includes('"busy"')) refusedBusy += 1;
          },
          close() {},
        },
        'ip-g',
      );
      guess?.onMessage(`{"t":"hello","v":1,"nick":"Тест","token":"o000000-0-1-${i}"}`);
      guess?.onClose();
    }
    expect(refusedBusy).toBeGreaterThan(5);
  });

  it('больше десяти соединений с одного адреса не принимается', () => {
    const { hub } = setup(4);
    let refused = 0;
    for (let i = 0; i < 14; i += 1) {
      const session = hub.connect(
        {
          send: (text) => {
            if (text.includes('"busy"')) refused += 1;
          },
          close() {},
        },
        'ip-many',
      );
      if (session === null) continue;
    }
    expect(refused).toBe(4);
  });
});

describe('сеть: экран игры поверх NetClient', () => {
  it('онлайн-матч отдаёт экрану виды, карточку гекса и маски; применение и ack работают как в воркере', () => {
    const { world, hub, link, client } = setup(13);
    client.start();
    world.run(1500);
    const token = client.session?.token ?? '';
    client.startMatch();
    world.run(1000);
    client.stop();

    const messages: FromWorker[] = [];
    const applier = new ViewDeltaApplier();
    const match = startOnlineMatch({
      connect: link.connect,
      token,
      nick: 'Тест',
      mapSize: MAP.width * MAP.height,
      clock: world.clock,
      onMessage: (m) => {
        messages.push(m);
        if (m.t !== 'view') return;
        // Как экран игры: применить вид и подтвердить его номером сообщения.
        if (m.kind === 'snapshot') applier.applySnapshot(m.snapshot);
        else applier.applyDelta(m.delta);
        match.ack(m.seq);
      },
    });
    world.run(5000);
    const state = hub.roomById(client.session?.room ?? '')?.state;
    const city = state?.cities.find((c) => c.owner === 0);
    match.select(city?.hex ?? 0);
    match.requestMask?.(5, 'supply');
    world.run(1000);

    const views = messages.filter((m) => m.t === 'view');
    expect(views.length).toBeGreaterThan(30);
    expect((state?.tick ?? 0) - (applier.view?.tick ?? 0)).toBeLessThan(5);
    const last = views.at(-1);
    expect(last?.t === 'view' && last.selection?.hex).toBe(city?.hex);
    const mask = messages.find((m) => m.t === 'mapMask');
    expect(mask?.t === 'mapMask' && mask.mask.length).toBe(MAP.width * MAP.height);
    match.dispose();
  });
});
