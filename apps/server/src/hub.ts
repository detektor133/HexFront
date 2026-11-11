// Хаб: сопоставляет подключения с комнатами, ведёт тики всех комнат с компенсацией дрейфа.
import { randomBytes, randomInt } from 'node:crypto';

import { generateMap, QUICK_MATCH_MAP_SIZE } from '@hexfront/mapgen';
import {
  decodeClientMessage,
  encodeServerMessage,
  MessageError,
  PROTOCOL_VERSION,
  QUICK_MATCH_SEEDS,
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
/** Сколько мс даётся соединению на `hello`; молчуны занимают сокеты и закрываются. */
export const HELLO_TIMEOUT_MS = 5000;
/** Сообщений в секунду от одного соединения (команды, ack, ping вместе); больше — разрыв. */
export const MAX_MESSAGES_PER_SECOND = 100;
/** Одновременных соединений с одного адреса. */
export const MAX_CONNECTIONS_PER_IP = 10;
/** Попыток `hello` в минуту с одного адреса (включая подбор токенов и кодов комнат). */
export const MAX_HELLOS_PER_MINUTE = 30;

export interface HubStats {
  readonly rooms: number;
  readonly humans: number;
  /** Время одного тика всех комнат, мс (по последним ~минуте). */
  readonly tickMs: { readonly p50: number; readonly p99: number; readonly max: number };
  /** Процессорное время процесса с запуска, мс. */
  readonly cpuMs: number;
  readonly rssMb: number;
}

const TICK_SAMPLES = 600;

export interface HubOptions {
  readonly now?: () => number;
  readonly size?: number;
  readonly fog?: boolean;
  /** Подмена карты в тестах; по умолчанию генерация по сиду комнаты. */
  readonly makeMap?: (seed: number, size: number) => MapStatic;
  readonly log?: (event: string, data?: Record<string, unknown>) => void;
  /** Предел комнат процесса: дальше новые входы получают `busy`. */
  readonly maxRooms?: number;
}

/** Карта комнаты: та же, что клиент берёт готовым файлом `gen-<сид>-30.json` (размер общий). */
export function quickMatchMap(seed: number, size: number): MapStatic {
  const loaded = loadMap(generateMap(seed, { ...QUICK_MATCH_MAP_SIZE, players: size }));
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  return loaded.map;
}

/** Одно соединение: разбор сообщений и привязка к месту в комнате. */
export class Session implements Connection {
  private room: Room | null = null;
  private readonly hub: Hub;
  private readonly out: Connection;
  /** Адрес для лимитов; закрытый ключ учёта в хабе. */
  public readonly ip: string;
  public readonly createdAt: number;
  private windowStart = 0;
  private windowCount = 0;
  private closed = false;

  public constructor(hub: Hub, out: Connection, ip: string, createdAt: number) {
    this.hub = hub;
    this.out = out;
    this.ip = ip;
    this.createdAt = createdAt;
  }

  /** Вошло ли соединение в комнату (после `hello`). */
  public get joined(): boolean {
    return this.room !== null;
  }

  /** Учёт частоты сообщений: превышение — разрыв, а не молчаливая обработка. */
  private overBudget(): boolean {
    const now = this.hub.clock();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    this.windowCount += 1;
    return this.windowCount > MAX_MESSAGES_PER_SECOND;
  }

  public send(text: string): void {
    this.out.send(text);
  }

  public close(): void {
    this.out.close();
  }

  /** Закрывает по требованию хаба (молчун, флуд). */
  public kick(reason: string): void {
    this.hub.log('kick', { reason, ip: this.ip });
    this.out.close();
    this.onClose();
  }

  /** Сообщение от клиента; невалидное отбрасывается, а не роняет комнату. */
  public onMessage(text: string): void {
    if (this.closed) return;
    if (this.overBudget()) {
      this.kick('flood');
      return;
    }
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
      case 'resync':
        room.resync(this);
        break;
      case 'select':
        room.select(this, message.hex);
        break;
      case 'query':
        room.query(this, message.id, message.q);
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
    if (this.closed) return;
    this.closed = true;
    this.room?.disconnect(this);
    this.hub.release(this);
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
  private readonly maxRooms: number;
  private readonly tickSamples = new Float64Array(TICK_SAMPLES);
  private tickCount = 0;
  private readonly sessions = new Set<Session>();
  private readonly perIp = new Map<string, number>();
  private readonly hellos = new Map<string, { start: number; count: number }>();

  public constructor(options: HubOptions = {}) {
    this.now = options.now ?? Date.now;
    this.size = options.size ?? MATCH_SIZE;
    this.fog = options.fog ?? true;
    this.makeMap = options.makeMap ?? quickMatchMap;
    this.logger = options.log ?? (() => undefined);
    this.maxRooms = options.maxRooms ?? 12;
  }

  /** Текущее время хаба, мс. */
  public clock(): number {
    return this.now();
  }

  public log(event: string, data?: Record<string, unknown>): void {
    this.logger(event, data);
  }

  /** Число комнат и людей, время тика хаба за последние ~минуту, процессор и память: `/healthz`. */
  public stats(): HubStats {
    let humans = 0;
    for (const room of this.rooms.values()) humans += room.humans;
    const used = this.tickSamples
      .slice(0, Math.min(this.tickCount, TICK_SAMPLES))
      .sort((a, b) => a - b);
    const pick = (p: number): number =>
      used[Math.min(used.length - 1, Math.floor(used.length * p))] ?? 0;
    const cpu = process.cpuUsage();
    return {
      rooms: this.rooms.size,
      humans,
      tickMs: { p50: pick(0.5), p99: pick(0.99), max: used.at(-1) ?? 0 },
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    };
  }

  public roomById(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Новое соединение. */
  public connect(out: Connection, ip = 'local'): Session | null {
    const count = this.perIp.get(ip) ?? 0;
    if (count >= MAX_CONNECTIONS_PER_IP) {
      this.log('tooManyConnections', { ip });
      out.send(encodeServerMessage({ t: 'refused', reason: 'busy' }));
      out.close();
      return null;
    }
    this.perIp.set(ip, count + 1);
    const session = new Session(this, out, ip, this.now());
    this.sessions.add(session);
    return session;
  }

  /** Соединение закрылось: снимаем с учёта. */
  public release(session: Session): void {
    this.sessions.delete(session);
    const left = (this.perIp.get(session.ip) ?? 1) - 1;
    if (left <= 0) this.perIp.delete(session.ip);
    else this.perIp.set(session.ip, left);
  }

  /** Лимит `hello` с адреса: подбор токенов и кодов комнат упирается в него. */
  private helloAllowed(ip: string): boolean {
    const now = this.now();
    const entry = this.hellos.get(ip);
    if (entry === undefined || now - entry.start >= 60_000) {
      this.hellos.set(ip, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= MAX_HELLOS_PER_MINUTE;
  }

  /** Обрабатывает `hello`: вход в открытую комнату, приглашение, создание закрытой, реконнект. */
  public hello(session: Session, message: Extract<C2S, { t: 'hello' }>): Room | null {
    if (!this.helloAllowed(session.ip)) return this.refuse(session, 'busy');
    if (message.v !== PROTOCOL_VERSION) return this.refuse(session, 'versionMismatch');
    const nick = sanitizeNick(message.nick);
    if (nick === null) return this.refuse(session, 'badNick');
    if (message.token !== undefined) {
      const room = this.rooms.get(roomOfToken(message.token));
      if (room !== undefined && room.reconnect(session, message.token, message.have) !== null) {
        return room;
      }
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
    if (message.mode === 'private') return this.createOrRefuse(session, 'private');
    for (const room of this.rooms.values()) {
      if (room.mode === 'open' && room.hasFreeSeat) return room;
    }
    return this.createOrRefuse(session, 'open');
  }

  private createOrRefuse(session: Session, mode: 'open' | 'private'): Room | null {
    const room = this.createRoom(mode);
    if (room === null) this.refuse(session, 'busy');
    return room;
  }

  private createRoom(mode: 'open' | 'private'): Room | null {
    if (this.rooms.size >= this.maxRooms) return null;
    const id =
      mode === 'private' ? randomBytes(3).toString('hex') : `o${randomBytes(3).toString('hex')}`;
    // Карта берётся из готовых файлов клиента (быстрый матч): сид из общего списка.
    const seed = QUICK_MATCH_SEEDS[randomInt(0, QUICK_MATCH_SEEDS.length)] ?? 42;
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
    const startedAt = performance.now();
    this.tickRooms();
    this.tickSamples[this.tickCount % TICK_SAMPLES] = performance.now() - startedAt;
    this.tickCount += 1;
  }

  private tickRooms(): void {
    const now = this.now();
    for (const session of this.sessions) {
      if (!session.joined && now - session.createdAt > HELLO_TIMEOUT_MS) session.kick('noHello');
    }
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
