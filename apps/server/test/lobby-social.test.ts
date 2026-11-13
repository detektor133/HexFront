import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { encodeClientMessage, PROTOCOL_VERSION, type C2S, type S2C } from '@hexfront/protocol';
import { loadMap, type MapJson } from '@hexfront/sim';

import { Hub, type Session } from '../src/hub.ts';

// Лобби закрытой комнаты: готовность, передача владельца, выбор точки, чат, метки и «ещё раз».
const json = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
) as MapJson;
const loaded = loadMap(json);
if (!loaded.ok) throw new Error('карта теста');
const MAP = loaded.map;

class Client {
  public readonly raw: string[] = [];
  public session: Session;
  public constructor(hub: Hub) {
    const session = hub.connect(
      { send: (text) => this.raw.push(text), close: () => undefined },
      'x',
    );
    if (session === null) throw new Error('отклонено');
    this.session = session;
  }
  public send(message: C2S): void {
    this.session.onMessage(encodeClientMessage(message));
  }
  public hello(nick: string, extra: Partial<Extract<C2S, { t: 'hello' }>> = {}): void {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, nick, ...extra });
  }
  public of<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] {
    return this.raw.map((text) => JSON.parse(text) as S2C).filter((m) => m.t === t) as Extract<
      S2C,
      { t: T }
    >[];
  }
}

function pair() {
  const hub = new Hub({ now: () => 1_000_000, size: 6, makeMap: () => MAP });
  const host = new Client(hub);
  host.hello('Хозяин', { mode: 'private' });
  const code = host.of('welcome')[0]?.room ?? '';
  const friend = new Client(hub);
  friend.hello('Друг', { room: code });
  return { hub, host, friend, code };
}

describe('лобби: готовность и владелец', () => {
  it('готовность видна всем в списке мест', () => {
    const { host, friend } = pair();
    friend.send({ t: 'ready', ready: true });
    const seats = host.of('lobby').at(-1)?.info.seats ?? [];
    expect(seats.map((s) => [s.nick, s.ready, s.host])).toEqual([
      ['Хозяин', false, true],
      ['Друг', true, false],
    ]);
  });

  it('хозяин передаёт комнату: новый хозяин на первом месте, чужая передача игнорируется', () => {
    const { host, friend } = pair();
    friend.send({ t: 'transfer', to: 0 });
    expect(host.of('lobby').at(-1)?.host).toBe(true);
    host.send({ t: 'transfer', to: 1 });
    expect(friend.of('lobby').at(-1)?.host).toBe(true);
    expect(host.of('lobby').at(-1)?.host).toBe(false);
    expect(friend.of('welcome').at(-1)?.playerId).toBe(0);
    expect(host.of('welcome').at(-1)?.playerId).toBe(1);
  });

  it('стартовая точка: занятую другим не выдают; на старте игрок получает свою', () => {
    const { hub, host, friend, code } = pair();
    host.send({ t: 'pick', spawn: 3 });
    friend.send({ t: 'pick', spawn: 3 });
    expect(friend.of('lobby').at(-1)?.info.seats[1]?.spawn).toBeNull();
    friend.send({ t: 'pick', spawn: 4 });
    host.send({ t: 'start' });
    hub.tickAll();
    const state = hub.roomById(code)?.state;
    const spawns = MAP.spawns;
    const home = (player: number): unknown =>
      state?.cities.find((c) => c.owner === player && c.hex !== undefined)?.hex;
    expect(home(0)).toBeDefined();
    expect(spawns[3]).toBeDefined();
    expect(state?.players).toHaveLength(6);
  });
});

describe('чат и метки', () => {
  it('общее и личное сообщение; пустое не принимается', () => {
    const { host, friend } = pair();
    host.send({ t: 'chat', text: 'привет' });
    expect(friend.of('chat')[0]).toMatchObject({ from: 0, nick: 'Хозяин', text: 'привет' });
    host.send({ t: 'chat', emoji: 2, to: 1 });
    expect(friend.of('chat')[1]).toMatchObject({ emoji: 2, to: 1 });
    host.send({ t: 'chat', text: '   ' });
    expect(friend.of('chat')).toHaveLength(2);
  });

  it('лимит частоты: пятое подряд сообщение отбрасывается', () => {
    const { host, friend } = pair();
    for (let i = 0; i < 6; i += 1) host.send({ t: 'chat', text: `m${i}` });
    expect(friend.of('chat')).toHaveLength(4);
  });
});

describe('«ещё раз»', () => {
  it('после матча хозяин возвращает присутствующих в лобби той же комнаты', () => {
    const { hub, host, friend, code } = pair();
    host.send({ t: 'start' });
    hub.tickAll();
    const room = hub.roomById(code);
    const outsider = new Client(hub);
    if (room?.state) room.state.winner = 0;
    hub.tickAll();
    hub.tickAll();
    expect(hub.roomById(code)).toBeDefined();
    outsider.send({ t: 'rematch' });
    expect(friend.of('rematch')).toHaveLength(0);
    host.send({ t: 'rematch' });
    expect(friend.of('rematch')).toHaveLength(1);
    expect(room?.phase).toBe('lobby');
    expect(friend.of('lobby').at(-1)?.info.humans).toBe(2);
  });
});

describe('случайная карта комнаты', () => {
  function genRoom() {
    const requested: [number, number][] = [];
    const hub = new Hub({
      now: () => 1_000_000,
      size: 6,
      makeMap: (seed, spawns) => {
        requested.push([seed, spawns]);
        return MAP;
      },
    });
    const host = new Client(hub);
    host.hello('Хозяин', { mode: 'private' });
    return { hub, host, requested, code: host.of('welcome')[0]?.room ?? '' };
  }

  it('любое зерно и размер от хозяина: карта строится заново, клиент узнаёт оба', () => {
    const { host, requested } = genRoom();
    host.send({ t: 'configure', seed: 1_234_567_890 });
    host.send({ t: 'configure', genSpawns: 60 });
    expect(requested.at(-2)).toEqual([1_234_567_890, 6]);
    expect(requested.at(-1)).toEqual([1_234_567_890, 60]);
    const welcome = host.of('welcome').at(-1);
    expect(welcome).toMatchObject({ seed: 1_234_567_890, genSpawns: 60 });
  });

  it('размер вне набора протокол отклоняет', () => {
    const { host } = genRoom();
    const before = host.of('welcome').length;
    host.send({ t: 'configure', genSpawns: 17 });
    expect(host.of('welcome')).toHaveLength(before);
  });

  it('«ещё раз» на случайной карте даёт новое зерно', () => {
    const { hub, host, code } = genRoom();
    host.send({ t: 'configure', seed: 5 });
    host.send({ t: 'start' });
    hub.tickAll();
    const room = hub.roomById(code);
    if (room?.state) room.state.winner = 0;
    hub.tickAll();
    hub.tickAll();
    host.send({ t: 'rematch' });
    expect(host.of('welcome').at(-1)?.seed).not.toBe(5);
  });
});
