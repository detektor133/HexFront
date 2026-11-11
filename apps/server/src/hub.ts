// Хаб: сопоставляет подключения с комнатами, ведёт тики всех комнат с компенсацией дрейфа.
import { randomBytes, randomInt } from 'node:crypto';

import { generateMap } from '@hexfront/mapgen';
import {
  decodeClientMessage,
  encodeServerMessage,
  MessageError,
  PROTOCOL_VERSION,
  type C2S,
  type RefuseReason,
} from '@hexfront/protocol';
import { loadMap, TICK_MS, type MapStatic } from '@hexfront/sim';

import { sanitizeNick } from './nick.ts';
import { Room, type Connection } from './room.ts';

/** Игроков в матче «быстрого матча»: люди и боты вместе (docs/stages/stage-09-analysis.md). */
export const MATCH_SIZE = 30;
/** Сколько тиков подряд хаб догоняет после задержки; дальше пропускает, чтобы не копить долг. */
const MAX_CATCH_UP = 3;
/** Закрытая комната без людей живёт дольше открытой, но не вечно. */
const ROOM_KEEP_MS = 60_000;

export interface HubOptions {
  readonly now?: () => number;
  readonly size?: number;
  readonly fog?: boolean;
  /** Подмена карты в тестах; по умолчанию генерация по сиду комнаты. */
  readonly makeMap?: (seed: number, size: number) => MapStatic;
  readonly log?: (event: string, data?: Record<string, unknown>) => void;
}

function defaultMap(seed: number, size: number): MapStatic {
  const loaded = loadMap(generateMap(seed, { players: size }));
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  return loaded.map;
}

/** Одно соединение: разбор сообщений и привязка к месту в комнате. */
export class Session implements Connection {
  private room: Room | null = null;
  private readonly hub: Hub;
  private readonly out: Connection;

  public constructor(hub: Hub, out: Connection) {
    this.hub = hub;
    this.out = out;
  }

  public send(text: string): void {
    this.out.send(text);
  }

  public close(): void {
    this.out.close();
  }

  /** Сообщение от клиента; невалидное отбрасывается, а не роняет комнату. */
  public onMessage(text: string): void {
    let message: C2S;
    try {
      message = decodeClientMessage(text);
    } catch (error) {
      if (error instanceof MessageError) {
        this.hub.log('badMessage', { reason: error.message });
        return;
      }
      throw error;
    }
    if (message.t === 'hello') {
      if (this.room === null) this.room = this.hub.hello(this, message);
      return;
    }
    const room = this.room;
    if (room === null) return;
    switch (message.t) {
      case 'cmd':
        room.command(this, message.seq, message.cmd);
        break;
      case 'viewAck':
        room.viewAck(this, message.tick);
        break;
      case 'start':
        room.startEarly(this);
        break;
      case 'ping':
        this.send(encodeServerMessage({ t: 'pong', at: message.at }));
        break;
    }
  }

  public onClose(): void {
    this.room?.disconnect(this);
  }
}

export class Hub {
  private readonly rooms = new Map<string, Room>();
  private readonly now: () => number;
  private readonly size: number;
  private readonly fog: boolean;
  private readonly makeMap: (seed: number, size: number) => MapStatic;
  private readonly emptySince = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;
  private logger: NonNullable<HubOptions['log']>;

  public constructor(options: HubOptions = {}) {
    this.now = options.now ?? Date.now;
    this.size = options.size ?? MATCH_SIZE;
    this.fog = options.fog ?? true;
    this.makeMap = options.makeMap ?? defaultMap;
    this.logger = options.log ?? (() => undefined);
  }

  public log(event: string, data?: Record<string, unknown>): void {
    this.logger(event, data);
  }

  /** Число комнат и людей: `/healthz` и метрики. */
  public stats(): { rooms: number; humans: number } {
    let humans = 0;
    for (const room of this.rooms.values()) humans += room.humans;
    return { rooms: this.rooms.size, humans };
  }

  public roomById(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Новое соединение. */
  public connect(out: Connection): Session {
    return new Session(this, out);
  }

  /** Обрабатывает `hello`: вход в открытую комнату, приглашение, создание закрытой, реконнект. */
  public hello(session: Session, message: Extract<C2S, { t: 'hello' }>): Room | null {
    if (message.v !== PROTOCOL_VERSION) return this.refuse(session, 'versionMismatch');
    const nick = sanitizeNick(message.nick);
    if (nick === null) return this.refuse(session, 'badNick');
    if (message.token !== undefined) {
      const room = this.rooms.get(roomOfToken(message.token));
      if (room !== undefined && room.reconnect(session, message.token) !== null) return room;
    }
    const room = this.pickRoom(session, message);
    if (room === null) return null;
    if (room.join(session, nick) === null) {
      this.refuse(session, 'roomFull');
      return null;
    }
    this.log('join', { room: room.id, humans: room.humans });
    return room;
  }

  private pickRoom(session: Session, message: Extract<C2S, { t: 'hello' }>): Room | null {
    if (message.room !== undefined) {
      const room = this.rooms.get(message.room);
      if (room === undefined) return this.refuseNull(session, 'noRoom');
      return room;
    }
    if (message.mode === 'private') return this.createRoom('private');
    for (const room of this.rooms.values()) {
      if (room.mode === 'open' && room.hasFreeSeat) return room;
    }
    return this.createRoom('open');
  }

  private createRoom(mode: 'open' | 'private'): Room {
    const id =
      mode === 'private' ? randomBytes(3).toString('hex') : `o${randomBytes(3).toString('hex')}`;
    const seed = randomInt(1, 2 ** 31 - 1);
    const room = new Room({
      id,
      mode,
      map: this.makeMap(seed, this.size),
      mapName: 'gen',
      seed,
      size: this.size,
      fog: this.fog,
      now: this.now,
    });
    this.rooms.set(id, room);
    this.log('roomCreated', { room: id, mode });
    return room;
  }

  private refuse(session: Session, reason: RefuseReason): null {
    session.send(encodeServerMessage({ t: 'refused', reason }));
    session.close();
    return null;
  }

  private refuseNull(session: Session, reason: RefuseReason): null {
    return this.refuse(session, reason);
  }

  /** Один шаг планировщика: набор, тики комнат, уборка пустых и законченных. */
  public tickAll(): void {
    const now = this.now();
    for (const [id, room] of this.rooms) {
      room.poll();
      room.tick();
      if (room.phase === 'ended') {
        room.close();
        this.rooms.delete(id);
        this.log('roomClosed', { room: id, ticks: room.stats.ticks });
        continue;
      }
      if (room.hasConnected()) this.emptySince.delete(id);
      else if (!this.emptySince.has(id)) this.emptySince.set(id, now);
      else if (now - (this.emptySince.get(id) ?? now) > ROOM_KEEP_MS) {
        room.close();
        this.rooms.delete(id);
        this.emptySince.delete(id);
        this.log('roomDropped', { room: id });
      }
    }
  }

  /** Запускает тики 10 Гц; следующий запуск считается от плана, а не от конца прошлого. */
  public start(): void {
    if (this.timer !== null) return;
    this.nextAt = performance.now() + TICK_MS;
    const loop = (): void => {
      let ran = 0;
      while (performance.now() >= this.nextAt && ran < MAX_CATCH_UP) {
        this.tickAll();
        this.nextAt += TICK_MS;
        ran += 1;
      }
      // Долг больше догоняемого: пропускаем, чтобы комнаты не жили в прошлом.
      if (performance.now() >= this.nextAt) this.nextAt = performance.now() + TICK_MS;
      this.timer = setTimeout(loop, Math.max(0, this.nextAt - performance.now()));
    };
    this.timer = setTimeout(loop, TICK_MS);
  }

  public stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
  }
}

/** Токен начинается с id комнаты: по нему находится комната без перебора. */
function roomOfToken(token: string): string {
  const index = token.indexOf('-');
  return index < 0 ? '' : token.slice(0, index);
}
