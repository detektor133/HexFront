import { describe, expect, it } from 'vitest';

import {
  decodeDelta,
  decodeMaskRle,
  decodeSnapshot,
  encodeClientMessage,
  PROTOCOL_VERSION,
  type C2S,
  type S2C,
} from '@hexfront/protocol';
import { loadMap, type Fp } from '@hexfront/sim';

import small from '../../../packages/mapgen/maps/small.json' with { type: 'json' };
import { Hub, type Session } from '../src/hub.ts';
import { GATHER_SECONDS, RECONNECT_SECONDS } from '../src/room.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const MAP = loaded.map;
const SIZE = 6;

/** Клиент в памяти: копит сырые сообщения сервера. */
class Client {
  public readonly raw: string[] = [];
  public closed = false;
  public session: Session;

  public constructor(hub: Hub, ip = 'local') {
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

  public get messages(): { t: string; [key: string]: unknown }[] {
    return this.raw.map((text) => JSON.parse(text) as { t: string; [key: string]: unknown });
  }

  public count(t: string): number {
    return this.messages.filter((m) => m.t === t).length;
  }

  public of<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] {
    return this.messages.filter((m) => m.t === t) as unknown as Extract<S2C, { t: T }>[];
  }
}

function setup() {
  let now = 1_000_000;
  const hub = new Hub({ now: () => now, size: SIZE, makeMap: () => MAP });
  return {
    hub,
    advance: (ms: number) => {
      now += ms;
    },
    tick: (n = 1) => {
      for (let i = 0; i < n; i += 1) hub.tickAll();
    },
  };
}

/** Клиент применяет всё как настоящий: подтверждает каждое сообщение вида. */
function ackAll(client: Client): void {
  for (const text of client.raw.splice(0)) {
    const message = JSON.parse(text) as { t: string; tick?: number };
    if ((message.t === 'snapshot' || message.t === 'delta') && message.tick !== undefined) {
      client.send({ t: 'viewAck', tick: message.tick });
    }
    client.raw.push(text);
  }
}

describe('вход и набор', () => {
  it('отказывает по версии протокола и по нику', () => {
    const { hub } = setup();
    const old = new Client(hub);
    old.send({ t: 'hello', v: PROTOCOL_VERSION + 1, nick: 'Игрок' });
    expect(old.of('refused')[0]?.reason).toBe('versionMismatch');
    expect(old.closed).toBe(true);

    const rude = new Client(hub);
    rude.hello('Хуйло');
    expect(rude.of('refused')[0]?.reason).toBe('badNick');
    const shortNick = new Client(hub);
    shortNick.hello('a');
    expect(shortNick.of('refused')[0]?.reason).toBe('badNick');
  });

  it('открытая комната собирает людей и через 30 с запускает матч с ботами', () => {
    const { hub, advance, tick } = setup();
    const a = new Client(hub);
    const b = new Client(hub);
    a.hello('Аня');
    b.hello('Борис');
    expect(a.of('welcome')[0]?.playerId).toBe(0);
    expect(b.of('welcome')[0]?.playerId).toBe(1);
    expect(a.of('welcome')[0]?.room).toBe(b.of('welcome')[0]?.room);
    expect(a.of('start')).toHaveLength(0);

    advance((GATHER_SECONDS + 1) * 1000);
    tick();
    expect(a.of('start')).toHaveLength(1);
    expect(b.count('snapshot')).toBe(1);
    const room = hub.roomById(a.of('welcome')[0]?.room ?? '');
    expect(room?.state?.players.map((p) => p.name).slice(0, 3)).toEqual([
      'Аня',
      'Борис',
      room?.state?.players[2]?.name,
    ]);
    expect(room?.state?.players[2]?.name).toContain('̲');
    expect(room?.state?.players).toHaveLength(SIZE);
  });

  it('закрытая комната живёт отдельно, вход по коду, старт хозяином', () => {
    const { hub, tick } = setup();
    const host = new Client(hub);
    host.hello('Хозяин', { mode: 'private' });
    const code = host.of('welcome')[0]?.room ?? '';
    const friend = new Client(hub);
    friend.hello('Друг', { room: code });
    expect(friend.of('welcome')[0]?.playerId).toBe(1);

    const stranger = new Client(hub);
    stranger.hello('Чужой');
    expect(stranger.of('welcome')[0]?.room).not.toBe(code);

    friend.send({ t: 'start' });
    tick();
    expect(host.of('start')).toHaveLength(0);
    host.send({ t: 'start' });
    tick();
    expect(host.of('start')).toHaveLength(1);

    const missing = new Client(hub);
    missing.hello('Некто', { room: 'нет' });
    expect(missing.of('refused')[0]?.reason).toBe('noRoom');
  });

  it('хозяин правит сложность и карту до старта, остальные не могут', () => {
    const { hub, tick } = setup();
    const host = new Client(hub);
    host.hello('Хозяин', { mode: 'private' });
    const code = host.of('welcome')[0]?.room ?? '';
    const friend = new Client(hub);
    friend.hello('Друг', { room: code });

    friend.send({ t: 'configure', level: 'easy', map: 'europe', players: 10 });
    expect(friend.of('lobby').at(-1)?.info.level).toBe('hard');

    host.send({ t: 'configure', level: 'easy', map: 'europe', players: 10 });
    expect(host.of('lobby').at(-1)?.info).toMatchObject({
      level: 'easy',
      map: 'europe',
      max: 10,
    });
    // Новое приветствие несёт карту и число игроков: клиент собирает матч по ним.
    expect(host.of('welcome').at(-1)).toMatchObject({ map: 'europe', players: 10 });
    expect(friend.of('welcome').at(-1)).toMatchObject({ map: 'europe', players: 10 });
    host.send({ t: 'start' });
    tick();
    expect(host.of('start')).toHaveLength(1);
  });

  it('место закрытой комнаты по токену не сажает в новую игру: матч окончен — «нет комнаты»', () => {
    const { hub } = setup();
    const a = new Client(hub);
    a.hello('Аня');
    const token = a.of('welcome')[0]?.token ?? '';
    const b = new Client(hub);
    b.hello('Аня', { token: token.replace(/^[^-]+/, 'zzzz') });
    expect(b.of('refused')[0]?.reason).toBe('noRoom');
    expect(b.of('welcome')).toHaveLength(0);
  });

  it('стартовые отряды человека сразу получают приказ занимать ничью землю', () => {
    const { hub, tick } = setup();
    const host = new Client(hub);
    host.hello('Хозяин', { mode: 'private' });
    host.send({ t: 'start' });
    tick();
    tick();
    const state = hub.roomById(host.of('welcome')[0]?.room ?? '')?.state;
    const mine = state?.armies.filter((a) => a.owner === 0) ?? [];
    expect(mine.length).toBeGreaterThan(0);
    expect(state?.units.some((u) => u.owner === 0 && u.order === 'move')).toBe(true);
  });
});

describe('матч: снимок, дельты и туман', () => {
  it('снимок, затем дельты в пределах окна; без viewAck поток останавливается', () => {
    const { hub, tick } = setup();
    const a = new Client(hub);
    a.hello('Аня', { mode: 'private' });
    a.send({ t: 'start' });
    tick();
    expect(a.count('snapshot')).toBe(1);
    // Окно отправки — 12 сообщений без подтверждения (снимок и 11 дельт), дальше сервер ждёт viewAck.
    tick(11);
    expect(a.count('delta')).toBe(11);
    tick(3);
    expect(a.count('delta')).toBe(11);

    ackAll(a);
    tick();
    expect(a.count('delta')).toBe(12);
    const snapshot = decodeSnapshot(a.raw.find((t) => t.includes('"t":"snapshot"')) ?? '');
    const delta = decodeDelta(a.raw.find((t) => t.includes('"t":"delta"')) ?? '');
    expect(delta.baseTick).toBe(snapshot.tick);
  });

  it('клиент не получает чужие отряды вне обзора, только свои и видимые', () => {
    const { hub, tick } = setup();
    const a = new Client(hub);
    const b = new Client(hub);
    a.hello('Аня', { mode: 'private' });
    b.hello('Борис', { room: a.of('welcome')[0]?.room ?? '' });
    a.send({ t: 'start' });
    tick(30);
    for (const client of [a, b]) ackAll(client);
    tick(60);

    const room = hub.roomById(a.of('welcome')[0]?.room ?? '');
    const state = room?.state;
    expect(state).toBeTruthy();
    if (!state) return;
    const snapshot = decodeSnapshot(b.raw.find((t) => t.includes('"t":"snapshot"')) ?? '');
    const hidden = state.units.filter((u) => {
      return u.owner === 0 && snapshot.view.hexes.visible[u.hex] === 0;
    });
    // Сырой текст сообщений Б не содержит ни одного скрытого отряда А.
    const fogged = new Set(hidden.map((u) => u.id));
    for (const unit of snapshot.view.units) {
      if (unit.owner !== 1) expect(fogged.has(unit.id) && unit.owner === 0).toBe(false);
    }
    expect(snapshot.view.playerId).toBe(1);
  });

  it('частота команд ограничена: лишние отклоняются с rateLimit', () => {
    const { hub, tick } = setup();
    const a = new Client(hub);
    a.hello('Аня', { mode: 'private' });
    a.send({ t: 'start' });
    tick();
    for (let seq = 1; seq <= 25; seq += 1)
      a.send({ t: 'cmd', seq, cmd: { t: 'setTax', rate: 300 as Fp } });
    expect(a.of('ack')).toHaveLength(20);
    // Лимит не теряет команды: 21-я не засчитана (rateLimit), следующие просят повтор по порядку (retry).
    expect(a.of('rejected').filter((m) => m.reason === 'rateLimit')).toHaveLength(1);
    expect(a.of('rejected').filter((m) => m.reason === 'retry')).toHaveLength(4);
  });

  it('после паузы команды, не принятые по лимиту, принимаются повтором по порядку', () => {
    const { hub, tick, advance } = setup();
    const a = new Client(hub);
    a.hello('Аня', { mode: 'private' });
    a.send({ t: 'start' });
    tick();
    for (let seq = 1; seq <= 25; seq += 1)
      a.send({ t: 'cmd', seq, cmd: { t: 'setTax', rate: 300 as Fp } });
    advance(1100);
    for (let seq = 21; seq <= 25; seq += 1)
      a.send({ t: 'cmd', seq, cmd: { t: 'setTax', rate: 300 as Fp } });
    expect(a.of('ack').map((m) => m.seq)).toEqual([
      ...Array.from({ length: 20 }, (_, i) => i + 1),
      21,
      22,
      23,
      24,
      25,
    ]);
    // Повтор уже принятой команды только подтверждается, второй раз не исполняется.
    a.send({ t: 'cmd', seq: 25, cmd: { t: 'setTax', rate: 300 as Fp } });
    expect(a.of('ack').at(-1)?.seq).toBe(25);
  });

  it('команда с чужим полем source и неизвестным типом отбрасывается до sim', () => {
    const { hub, tick } = setup();
    const a = new Client(hub);
    a.hello('Аня', { mode: 'private' });
    a.send({ t: 'start' });
    tick();
    a.session.onMessage('{"t":"cmd","seq":1,"cmd":{"t":"hack"}}');
    a.session.onMessage('{"t":"cmd","seq":2,"cmd":{"t":"setTax","rate":1,"source":"auto"}}');
    a.session.onMessage('not json');
    expect(a.of('ack')).toHaveLength(0);
  });
});

describe('реконнект и передача боту', () => {
  it('в течение 30 с игрок возвращается по токену со свежим снимком', () => {
    const { hub, advance, tick } = setup();
    const a = new Client(hub);
    a.hello('Аня', { mode: 'private' });
    const token = a.of('welcome')[0]?.token ?? '';
    const room = a.of('welcome')[0]?.room ?? '';
    a.send({ t: 'start' });
    tick(5);
    a.session.onClose();
    advance((RECONNECT_SECONDS - 5) * 1000);
    tick(3);

    const back = new Client(hub);
    back.hello('Аня', { token });
    expect(back.of('welcome')[0]?.playerId).toBe(0);
    expect(back.of('welcome')[0]?.room).toBe(room);
    expect(a.closed).toBe(false);
    tick();
    expect(back.count('snapshot')).toBe(1);
    const state = hub.roomById(room)?.state;
    expect(state?.armies.filter((army) => army.owner === 0).every((army) => !army.auto)).toBe(true);
  });

  it('через 30 с без связи армии игрока переходят командиру, возврат отдаёт управление', () => {
    const { hub, advance, tick } = setup();
    const a = new Client(hub);
    a.hello('Аня', { mode: 'private' });
    const token = a.of('welcome')[0]?.token ?? '';
    const room = a.of('welcome')[0]?.room ?? '';
    a.send({ t: 'start' });
    tick(2);
    a.session.onClose();
    advance((RECONNECT_SECONDS + 1) * 1000);
    tick();
    const state = hub.roomById(room)?.state;
    expect(state?.players[0]?.autoCommand).toBe(true);
    expect(state?.armies.filter((army) => army.owner === 0).every((army) => army.auto)).toBe(true);

    const back = new Client(hub);
    back.hello('Аня', { token });
    expect(state?.players[0]?.autoCommand).toBe(false);
  });
});

describe('запросы по полному состоянию', () => {
  function started() {
    const env = setup();
    const a = new Client(env.hub);
    a.hello('Аня', { mode: 'private' });
    a.send({ t: 'start' });
    env.tick(3);
    const room = env.hub.roomById(a.of('welcome')[0]?.room ?? '');
    return { ...env, a, state: room?.state };
  }

  it('карточка своего города приходит сразу, чужой скрытый город — пустая карточка', () => {
    const { a, state, tick } = started();
    const own = state?.cities.find((c) => c.owner === 0);
    const hidden = state?.cities.find(
      (c) => c.owner !== 0 && state.vision?.visible[0]?.[c.hex] !== 1,
    );
    expect(own && hidden).toBeTruthy();
    a.send({ t: 'select', hex: own?.hex ?? 0 });
    expect(a.of('selection').at(-1)?.sel?.hex).toBe(own?.hex);
    expect(a.of('selection').at(-1)?.sel?.city).toBeTruthy();
    a.send({ t: 'select', hex: hidden?.hex ?? 0 });
    expect(a.of('selection').at(-1)?.sel).toBeNull();
    tick();
    // Строка не должна нести сведений о скрытом городе.
    expect(a.raw.at(-1)).not.toContain(`"hex":${hidden?.hex}`);
  });

  it('маска снабжения разворачивается в размер карты, запросы ограничены по частоте', () => {
    const { a, state } = started();
    const size = (state?.map.width ?? 0) * (state?.map.height ?? 0);
    for (let id = 1; id <= 40; id += 1)
      a.send({ t: 'query', id, q: { kind: 'mask', mode: 'supply' } });
    const masks = a.of('mapMask');
    expect(masks).toHaveLength(30);
    expect(decodeMaskRle(masks[0]?.rle ?? [], size)).toHaveLength(size);
  });

  it('прогноз пути за пределы карты и чужие отряды не раскрывает ничего', () => {
    const { a, state } = started();
    a.send({ t: 'query', id: 1, q: { kind: 'path', unitIds: [1], to: 99_999_999, via: [] } });
    expect(a.of('pathPreview')).toHaveLength(0);
    const foreign = state?.units.find((u) => u.owner !== 0);
    a.send({
      t: 'query',
      id: 2,
      q: { kind: 'path', unitIds: [foreign?.id ?? -1], to: 0, via: [] },
    });
    const reply = a.of('pathPreview')[0];
    expect(reply === undefined || reply.preview === null).toBe(true);
  });
});

describe('нагрузка старта', () => {
  it('стартовые снимки раздаются порциями, а не всем на одном тике', () => {
    const { hub, tick } = setup();
    const clients = Array.from({ length: SIZE }, (_, i) => new Client(hub, `ip-${i}`));
    clients[0]?.hello('Игрок0', { mode: 'private' });
    const room = clients[0]?.of('welcome')[0]?.room ?? '';
    clients.slice(1).forEach((c, i) => c.hello(`Игрок${i + 1}`, { room }));
    clients[0]?.send({ t: 'start' });
    tick();
    const received = (): number => clients.filter((c) => c.count('snapshot') > 0).length;
    expect(received()).toBe(4);
    tick();
    expect(received()).toBe(SIZE);
  });
});

describe('онлайн считается по живым соединениям', () => {
  it('ушедший из лобби освобождает место, хозяином становится следующий', () => {
    const { hub } = setup();
    const a = new Client(hub, 'ip-a');
    const b = new Client(hub, 'ip-b');
    a.hello('Аня', { mode: 'private' });
    b.hello('Борис', { room: a.of('welcome')[0]?.room ?? '' });
    expect(b.of('lobby').at(-1)?.info.humans).toBe(2);
    expect(b.of('lobby').at(-1)?.host).toBe(false);

    a.session.onClose();
    const last = b.of('lobby').at(-1);
    expect(last?.info.humans).toBe(1);
    expect(last?.host).toBe(true);
    expect(hub.stats().humans).toBe(1);
  });

  it('пустая открытая комната забывает отсчёт: новый игрок не стартует матч мгновенно', () => {
    const { hub, advance, tick } = setup();
    const a = new Client(hub, 'ip-a');
    a.hello('Аня');
    advance((GATHER_SECONDS - 1) * 1000);
    a.session.onClose();
    const b = new Client(hub, 'ip-b');
    b.hello('Борис');
    advance(5000);
    tick();
    expect(b.of('start')).toHaveLength(0);
    expect(b.of('lobby').at(-1)?.info.startsInS).toBeGreaterThan(20);
  });

  it('в матче отключившийся не считается онлайном, но место держится', () => {
    const { hub, tick } = setup();
    const a = new Client(hub, 'ip-a');
    a.hello('Аня', { mode: 'private' });
    a.send({ t: 'start' });
    tick();
    expect(hub.stats().humans).toBe(1);
    a.session.onClose();
    expect(hub.stats().humans).toBe(0);
    expect(hub.roomById(a.of('welcome')[0]?.room ?? '')?.humans).toBe(1);
  });
});

describe('упаковка комнат', () => {
  function packing(options: { budgetMs?: number; lateJoinSeconds?: number } = {}) {
    let now = 1_000_000;
    const hub = new Hub({
      now: () => now,
      size: SIZE,
      makeMap: () => MAP,
      lateJoinSeconds: 30,
      ...options,
    });
    return {
      hub,
      advance: (ms: number) => {
        now += ms;
      },
      tick: (n = 1) => {
        for (let i = 0; i < n; i += 1) hub.tickAll();
      },
    };
  }

  it('новый игрок подсаживается на место бота в идущей открытой игре, а не создаёт комнату', () => {
    const { hub, advance, tick } = packing();
    const a = new Client(hub, 'ip-a');
    a.hello('Аня');
    advance((GATHER_SECONDS + 1) * 1000);
    tick(5);
    const roomId = a.of('welcome')[0]?.room ?? '';

    const b = new Client(hub, 'ip-b');
    b.hello('Борис');
    const welcome = b.of('welcome')[0];
    expect(welcome?.room).toBe(roomId);
    expect(b.of('start')).toHaveLength(1);
    expect(hub.stats().rooms).toBe(1);

    const state = hub.roomById(roomId)?.state;
    const player = state?.players[welcome?.playerId ?? -1];
    expect(player?.name).toBe('Борис');
    expect(welcome?.playerId).not.toBe(0);
    // Страна человека не под автокомандованием, у бота она была под ним.
    expect(player?.autoCommand).toBe(false);
    expect(
      state?.armies.filter((army) => army.owner === welcome?.playerId).every((x) => !x.auto),
    ).toBe(true);
    tick(3);
    expect(b.count('snapshot')).toBeGreaterThan(0);
  });

  it('после окна подсадки новые игроки получают новую комнату, места бота не заняты дважды', () => {
    const { hub, advance, tick } = packing({ lateJoinSeconds: 5 });
    const first = new Client(hub, 'ip-0');
    first.hello('Игрок0');
    advance((GATHER_SECONDS + 1) * 1000);
    tick(3);
    const ids = new Set<number>([first.of('welcome')[0]?.playerId ?? -1]);
    for (let i = 1; i < 4; i += 1) {
      const c = new Client(hub, `ip-${i}`);
      c.hello(`Игрок${i}`);
      ids.add(c.of('welcome')[0]?.playerId ?? -1);
    }
    expect(ids.size).toBe(4);
    expect(hub.stats().rooms).toBe(1);

    tick(60);
    const late = new Client(hub, 'ip-late');
    late.hello('Поздний');
    expect(late.of('welcome')[0]?.room).not.toBe(first.of('welcome')[0]?.room);
    expect(hub.stats().rooms).toBe(2);
  });

  it('допуск по цене: комнаты сверх бюджета тика не создаются, идущие матчи не страдают', () => {
    const { hub } = packing({ budgetMs: 20 });
    const refusals: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const c = new Client(hub, `ip-${i}`);
      c.hello(`Игрок${i}`, { mode: 'private' });
      if (c.of('refused')[0]) refusals.push(c.of('refused')[0]?.reason ?? '');
    }
    expect(hub.stats().rooms).toBe(2);
    expect(refusals).toEqual(['busy', 'busy']);
    expect(hub.stats().budgetMs).toBe(20);
    expect(hub.stats().projectedMs).toBeGreaterThan(0);
  });
});

describe('дренаж перед выкладкой', () => {
  it('идущие матчи доигрываются и реконнект работает, новых игроков сервер не берёт', () => {
    const { hub, tick } = setup();
    const a = new Client(hub, 'ip-a');
    a.hello('Аня', { mode: 'private' });
    const token = a.of('welcome')[0]?.token ?? '';
    a.send({ t: 'start' });
    tick(3);

    hub.drain();
    expect(hub.stats().draining).toBe(true);

    const fresh = new Client(hub, 'ip-b');
    fresh.hello('Борис');
    expect(fresh.of('refused')[0]?.reason).toBe('busy');
    const room = new Client(hub, 'ip-c');
    room.hello('Вика', { mode: 'private' });
    expect(room.of('refused')[0]?.reason).toBe('busy');

    a.session.onClose();
    const back = new Client(hub, 'ip-a2');
    back.hello('Аня', { token });
    expect(back.of('welcome')).toHaveLength(1);
    tick(2);
    expect(back.count('snapshot')).toBeGreaterThan(0);
  });
});

describe('наблюдение выбывшего', () => {
  function runningRoom() {
    const ctx = setup();
    const a = new Client(ctx.hub, 'ip-a');
    a.hello('Аня', { mode: 'private' });
    const code = a.of('welcome')[0]?.room ?? '';
    const b = new Client(ctx.hub, 'ip-b');
    b.hello('Борис', { room: code });
    a.send({ t: 'start' });
    ctx.tick(3);
    const room = ctx.hub.roomById(code);
    if (room?.state == null) throw new Error('матч не запущен');
    return { ...ctx, a, b, state: room.state };
  }

  function lastViewPlayer(client: Client): number | undefined {
    const text = [...client.raw]
      .reverse()
      .find((raw) => raw.startsWith('{"t":"snapshot"') || raw.includes('"t":"snapshot"'));
    return text === undefined ? undefined : decodeSnapshot(text).view.playerId;
  }

  it('живой игрок не может смотреть чужими глазами', () => {
    const { a, tick } = runningRoom();
    a.raw.length = 0;
    a.send({ t: 'watch', player: 1 });
    tick(2);
    expect(a.count('snapshot')).toBe(0);
  });

  it('выбывший получает вид выбранного игрока, и его команды не исполняются', () => {
    const { a, state, tick } = runningRoom();
    const me = state.players[0];
    if (me === undefined) throw new Error('нет игрока');
    me.status = 'eliminated';
    ackAll(a);
    a.raw.length = 0;

    a.send({ t: 'watch', player: 1 });
    tick(2);
    expect(lastViewPlayer(a)).toBe(1);

    a.send({ t: 'cmd', seq: 1, cmd: { t: 'setTax', rate: 10 } as never });
    expect(a.of('rejected')[0]?.reason).toBe('bad');

    ackAll(a);
    a.raw.length = 0;
    a.send({ t: 'watch', player: 0 });
    tick(2);
    expect(lastViewPlayer(a)).toBe(0);
  });
});

describe('зритель по коду комнаты', () => {
  it('код комнаты можно ввести в любом регистре', () => {
    const { hub, tick } = setup();
    const host = new Client(hub, 'ip-a');
    host.hello('Аня', { mode: 'private' });
    const code = host.of('welcome')[0]?.room ?? '';
    host.send({ t: 'start' });
    tick(3);
    const viewer = new Client(hub, 'ip-v');
    viewer.hello('Зритель', { room: code.toUpperCase(), spectate: true });
    expect(viewer.of('welcome')[0]?.room).toBe(code);
  });

  it('зритель входит в идущий матч, получает вид игрока и не командует', () => {
    const { hub, tick } = setup();
    const host = new Client(hub, 'ip-a');
    host.hello('Аня', { mode: 'private' });
    const code = host.of('welcome')[0]?.room ?? '';
    host.send({ t: 'start' });
    tick(3);

    const viewer = new Client(hub, 'ip-v');
    viewer.hello('Зритель', { room: code, spectate: true });
    const welcome = viewer.of('welcome')[0];
    expect(welcome?.spectator).toBe(true);
    expect(welcome?.playerId).toBe(0);
    expect(viewer.of('start')).toHaveLength(1);
    tick(2);
    expect(viewer.count('snapshot')).toBeGreaterThan(0);

    viewer.send({ t: 'cmd', seq: 1, cmd: { t: 'setTax', rate: 10 } as never });
    expect(viewer.of('rejected')[0]?.reason).toBe('bad');

    // Зритель смотрит любого игрока, в том числе живого.
    ackAll(viewer);
    viewer.raw.length = 0;
    viewer.send({ t: 'watch', player: 3 });
    tick(2);
    const last = [...viewer.raw].reverse().find((text) => text.includes('"t":"snapshot"'));
    expect(last === undefined ? undefined : decodeSnapshot(last).view.playerId).toBe(3);

    // Зритель не занимает место и не считается игроком комнаты.
    expect(hub.roomById(code)?.humans).toBe(1);
    expect(hub.roomById(code)?.connected).toBe(1);
  });

  it('в наборе смотреть нельзя, без кода и в несуществующую комнату — отказ', () => {
    const { hub } = setup();
    const host = new Client(hub, 'ip-a');
    host.hello('Аня', { mode: 'private' });
    const code = host.of('welcome')[0]?.room ?? '';

    const early = new Client(hub, 'ip-v1');
    early.hello('Зритель', { room: code, spectate: true });
    expect(early.of('refused')[0]?.reason).toBe('notRunning');

    const blind = new Client(hub, 'ip-v2');
    blind.hello('Зритель', { spectate: true });
    expect(blind.of('refused')[0]?.reason).toBe('badHello');

    const lost = new Client(hub, 'ip-v3');
    lost.hello('Зритель', { room: 'NOPE', spectate: true });
    expect(lost.of('refused')[0]?.reason).toBe('noRoom');
  });

  it('зритель возвращается по токену и получает конец матча', () => {
    const { hub, tick } = setup();
    const host = new Client(hub, 'ip-a');
    host.hello('Аня', { mode: 'private' });
    const code = host.of('welcome')[0]?.room ?? '';
    host.send({ t: 'start' });
    tick(3);
    const viewer = new Client(hub, 'ip-v');
    viewer.hello('Зритель', { room: code, spectate: true });
    const token = viewer.of('welcome')[0]?.token ?? '';
    viewer.session.onClose();

    const back = new Client(hub, 'ip-v2');
    back.hello('Зритель', { token });
    expect(back.of('welcome')[0]?.spectator).toBe(true);

    const state = hub.roomById(code)?.state;
    if (state == null) throw new Error('нет матча');
    state.winner = 0;
    tick(1);
    expect(back.of('end')).toHaveLength(1);
  });
});
