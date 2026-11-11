// Хаос-тест сети на виртуальном времени: 30 настоящих клиентов в одной комнате настоящего хаба.
// У каждого свой пинг; случайные обрывы, «чёрные дыры», скачки задержки; шторм переподключений
// всех сразу; потеря связи дольше 30 с (управление уходит боту и возвращается); читер рядом.
// Время не ждётся: ~4 минуты игры проходят за десятки секунд процессорного времени.
import { describe, expect, it } from 'vitest';

import { Link, World } from './net-harness.ts';
import { NetClient } from '../../../apps/client/src/net/net-client.ts';
import { Hub } from '../../../apps/server/src/hub.ts';
import { quickMatchMap } from '../../../apps/server/src/maps.ts';
import { encodeClientMessage, PROTOCOL_VERSION } from '../../../packages/protocol/src/index.ts';
import type { Command } from '../../../packages/sim/src/index.ts';

const CLIENTS = 30;
const CHAOS_START_S = 15;
const CHAOS_S = 120;
const SETTLE_S = 70;

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const rejections: Record<string, number> = {};

interface Player {
  index: number;
  client: NetClient;
  link: Link;
  issued: number;
  snapshots: number;
}

describe('хаос-тест сети: 30 клиентов, обрывы, потери, шторм переподключений', () => {
  it('матч доходит до конца без потерь и дублей, управление возвращается, читер отключён', () => {
    const random = seeded(2026);
    const world = new World();
    const hub = new Hub({
      now: () => world.time,
      size: CLIENTS,
      makeMap: quickMatchMap,
      budgetMs: 1e9,
      maxRooms: 4,
      lateJoinSeconds: 0,
    });
    let ticking = true;
    let ticks = 0;
    const tickLoop = (): void => {
      if (!ticking) return;
      hub.tickAll();
      ticks += 1;
      world.after(100, tickLoop);
    };
    world.after(100, tickLoop);

    const players: Player[] = [];
    const make = (index: number, room: string | undefined): Player => {
      const link = new Link(world, hub, random, `ip-${index}`);
      link.oneWayMs = 10 + Math.floor(random() * 110);
      link.jitterMs = 10 + Math.floor(random() * 40);
      const player: Player = {
        index,
        link,
        issued: 0,
        snapshots: 0,
        client: new NetClient({
          connect: link.connect,
          clock: world.clock,
          nick: `Игрок ${index}`,
          mode: 'private',
          ...(room === undefined ? {} : { room }),
          random,
          handlers: {
            onRejected: (_seq, reason) => {
              rejections[reason] = (rejections[reason] ?? 0) + 1;
            },
            onView: (_view, _events, full) => {
              if (full) player.snapshots += 1;
            },
          },
        }),
      };
      player.client.start();
      players.push(player);
      return player;
    };

    // Вход: хозяин создаёт закрытую комнату, остальные заходят по коду; на 30-м месте матч стартует.
    const host = make(0, undefined);
    world.run(2000);
    const code = host.client.session?.room;
    expect(code).toBeTruthy();
    for (let i = 1; i < CLIENTS; i += 1) make(i, code);
    world.run(8000);
    const room = hub.roomById(code ?? '');
    expect(room?.phase).toBe('running');
    const state = room?.state;
    if (!state) throw new Error('матч не стартовал');
    const startTick = state.tick;

    // Поток команд: у каждого клиента раз в 1–3 с новая армия с уникальным именем.
    let working = true;
    const work = (player: Player): void => {
      if (!working) return;
      player.issued += 1;
      player.client.command({
        t: 'createArmy',
        name: `a${player.index}_${player.issued}`,
      } as Command);
      world.after(1000 + Math.floor(random() * 2000), () => {
        work(player);
      });
    };
    for (const player of players) world.after(Math.floor(random() * 2000), () => work(player));

    // Случайный хаос раз в секунду на каждого клиента.
    let chaos = true;
    const roll = (player: Player): void => {
      if (!chaos) return;
      const dice = random();
      if (dice < 0.03) player.link.drop();
      else if (dice < 0.04) player.link.blackholeFor(3000 + Math.floor(random() * 9000));
      else if (dice < 0.06) {
        const { oneWayMs, jitterMs } = player.link;
        player.link.oneWayMs = 300;
        player.link.jitterMs = 150;
        world.after(5000, () => {
          player.link.oneWayMs = oneWayMs;
          player.link.jitterMs = jitterMs;
        });
      }
      world.after(1000, () => {
        roll(player);
      });
    };
    for (const player of players) world.after(Math.floor(random() * 1000), () => roll(player));

    world.run(CHAOS_START_S * 1000);

    // Шторм переподключений: все 30 клиентов рвут связь в один миг.
    world.run(50_000);
    for (const player of players) player.link.drop();

    // Потеря связи дольше 30 с у восьми клиентов: сервер замечает через 20 с, через 30 с без
    // связи управление переходит боту, при возврате отдаётся обратно.
    world.run(20_000);
    const away = players.slice(20, 28);
    for (const player of away) player.link.blackholeFor(60_000);
    world.run(55_000);
    const botControlled = away.filter((p) => {
      const id = p.client.session?.playerId ?? -1;
      return state.players[id]?.autoCommand === true;
    }).length;

    // Читер: флуд, мусор, подбор токенов.
    const cheaterReplies: string[] = [];
    let cheaterClosed = false;
    const cheater = hub.connect(
      {
        send: (text) => cheaterReplies.push(text),
        close: () => {
          cheaterClosed = true;
        },
      },
      'ip-cheat',
    );
    for (let i = 0; i < 400; i += 1) cheater?.onMessage('{"t":"ping","at":1}');
    cheater?.onMessage('мусор');
    expect(cheaterClosed).toBe(true);
    for (let i = 0; i < 40; i += 1) {
      const guesser = hub.connect(
        { send: () => undefined, close: () => undefined },
        `ip-g${i % 3}`,
      );
      guesser?.onMessage(
        encodeClientMessage({
          t: 'hello',
          v: PROTOCOL_VERSION,
          nick: 'Угадайка',
          token: `${code}-0-1-подбор${i}`,
        }),
      );
      guesser?.onClose();
    }

    world.run((CHAOS_S - 50 - 20 - 55 + CHAOS_START_S) * 1000);
    chaos = false;
    // Всё успокаивается: каналы ровные, потоки команд продолжаются, ждём возврата всех.
    for (const player of players) {
      player.link.blackhole = false;
      player.link.oneWayMs = 30;
      player.link.jitterMs = 10;
    }
    world.run(SETTLE_S * 1000);
    working = false;
    world.run(10_000);
    const chaosTicks = ticks;

    // Итоги по клиентам.
    const lagOf = (p: Player): number => state.tick - (p.client.view?.tick ?? 0);
    const maxLag = Math.max(...players.map(lagOf));
    const offline = players.filter((p) => p.client.status !== 'online');
    const unacked = players.filter((p) => p.client.unacked > 0);
    const reconnects = players.reduce((sum, p) => sum + p.link.connects - 1, 0);
    const snapshots = players.reduce((sum, p) => sum + p.snapshots, 0);
    const resumed = reconnects - (snapshots - CLIENTS);

    // Команды исполнены ровно по разу: имена армий не повторяются и не потеряны.
    const duplicates: string[] = [];
    const missing: string[] = [];
    for (const player of players) {
      const id = player.client.session?.playerId ?? -1;
      const names = state.armies.filter((a) => a.owner === id).map((a) => a.name ?? '');
      for (let n = 1; n <= player.issued; n += 1) {
        const count = names.filter((name) => name === `a${player.index}_${n}`).length;
        if (count > 1) duplicates.push(`a${player.index}_${n}`);
        if (count === 0) missing.push(`a${player.index}_${n}`);
      }
    }

    // Политическая карта у каждого клиента совпадает с серверной.
    let worstDiff = 0;
    for (const player of players) {
      const view = player.client.view;
      if (!view) continue;
      let diff = 0;
      for (let h = 0; h < state.hexes.owner.length; h += 1) {
        if (view.hexes.owner[h] !== state.hexes.owner[h]) diff += 1;
      }
      worstDiff = Math.max(worstDiff, diff / state.hexes.owner.length);
    }
    const humansStillBots = players.filter((p) => {
      const id = p.client.session?.playerId ?? -1;
      return state.players[id]?.autoCommand === true;
    }).length;

    const stats = hub.stats();
    console.log(
      `ХАОС: тиков матча ${chaosTicks - 0} (с ${startTick}), переподключений ${reconnects}, ` +
        `полных снимков ${snapshots - CLIENTS} из них вместо дельт, возобновлено дельтами ≈ ${resumed}; ` +
        `макс. отставание ${maxLag} тиков; команд выдано ${players.reduce((s, p) => s + p.issued, 0)}; ` +
        `передано боту ${botControlled} из ${away.length}; ` +
        `тик сервера p99 ${stats.tickMs.p99.toFixed(1)} мс, макс ${stats.tickMs.max.toFixed(1)} мс`,
    );

    const lostByClient: Record<string, number> = {};
    for (const name of missing) {
      const key = name.split('_')[0] ?? '';
      lostByClient[key] = (lostByClient[key] ?? 0) + 1;
    }
    console.log(
      `ОТКАЗЫ: ${JSON.stringify(rejections)}; пропало команд по клиентам: ${JSON.stringify(lostByClient)}`,
    );
    expect(offline.map((p) => p.index)).toEqual([]);
    expect(unacked.map((p) => p.index)).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(missing).toEqual([]);
    expect(botControlled).toBe(away.length);
    expect(humansStillBots).toBe(0);
    expect(maxLag).toBeLessThanOrEqual(4);
    expect(worstDiff).toBeLessThan(0.01);
    expect(stats.rooms).toBe(1);
    expect(reconnects).toBeGreaterThan(CLIENTS);
    // Возобновление работает: заметно больше обрывов, чем полных снимков сверх первого.
    expect(snapshots - CLIENTS).toBeLessThan(reconnects);
    ticking = false;
  }, 240_000);
});
