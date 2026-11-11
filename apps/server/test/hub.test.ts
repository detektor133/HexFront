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
    expect(room?.state?.players.map((p) => p.name).slice(0, 3)).toEqual(['Аня', 'Борис', 'Бот 1']);
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
    expect(a.of('rejected').filter((m) => m.reason === 'rateLimit')).toHaveLength(5);
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
