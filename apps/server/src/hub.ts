// Шлюз (хаб): I/O-поток. Сокеты, лимиты, проверка сообщений, допуск и размещение комнат по шардам.
// Комнаты и их тики живут в шардах (`shard.ts`): встроенном потоке или воркерах (`worker-shard.ts`);
// шлюз не считает игру и не блокируется её тиками, поэтому пинги и отправка идут ровно даже под нагрузкой.
import { randomBytes, randomInt } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import {
  decodeClientMessage,
  encodeServerMessage,
  MessageError,
  PROTOCOL_VERSION,
  QUICK_MATCH_SEEDS,
  type C2S,
  type JoinMode,
  type RefuseReason,
} from '@hexfront/protocol';
import type { MapStatic } from '@hexfront/sim';

import { cachedMap } from './maps.ts';
import { sanitizeNick } from './nick.ts';
import { LATE_JOIN_TICKS, type Connection, type Room } from './room.ts';
import type { HostSettings, RoomStatus, TickStats } from './shard-protocol.ts';
import { InlineShard, type Shard, type ShardEvents } from './shard.ts';
import { WorkerShard } from './worker-shard.ts';

export { quickMatchMap, warmMaps } from './maps.ts';

/** Игроков в матче «быстрого матча»: люди и боты вместе (docs/stages/stage-09-analysis.md). */
export const MATCH_SIZE = 30;
/** Сколько мс даётся соединению на `hello`; молчуны занимают сокеты и закрываются. */
export const HELLO_TIMEOUT_MS = 5000;
/** Сообщений в секунду от одного соединения (команды, ack, ping вместе); больше — разрыв. */
export const MAX_MESSAGES_PER_SECOND = 100;
/** Одновременных соединений с одного адреса. */
export const MAX_CONNECTIONS_PER_IP = 10;
/** Попыток `hello` в минуту с одного адреса (включая подбор токенов и кодов комнат). */
export const MAX_HELLOS_PER_MINUTE = 30;

export interface ShardStats {
  readonly index: number;
  readonly rooms: number;
  readonly humans: number;
  readonly projectedMs: number;
  readonly tickMs: TickStats;
  readonly lateMs: TickStats;
  readonly utilization: number;
  readonly droppedTicks: number;
  readonly overloaded: boolean;
}

export interface HubStats {
  readonly rooms: number;
  readonly humans: number;
  /** Прогноз суммы цен комнат по всем шардам, мс на тик, и общий бюджет (бюджет шарда × шарды). */
  readonly projectedMs: number;
  readonly budgetMs: number;
  /** Время тика самого нагруженного шарда, мс (по последним ~минуте). */
  readonly tickMs: TickStats;
  readonly shards: readonly ShardStats[];
  /** Задержка цикла событий I/O-потока (p99, мс): растёт, если шлюз не успевает. */
  readonly ioLagMs: number;
  /** Процессорное время всего процесса (все потоки) с запуска, мс. */
  readonly cpuMs: number;
  readonly rssMb: number;
  /** Идёт дренаж: сервер доигрывает матчи и не берёт новых игроков. */
  readonly draining: boolean;
  /** Хотя бы один шард перегружен: новые комнаты ему не даются, игра в его комнатах может идти медленнее. */
  readonly overloaded: boolean;
}

export interface HubOptions {
  readonly now?: () => number;
  readonly size?: number;
  readonly fog?: boolean;
  /** Подмена карты во встроенном шарде (тесты); воркеры генерируют сами. */
  readonly makeMap?: (seed: number, size: number) => MapStatic;
  readonly log?: (event: string, data?: Record<string, unknown>) => void;
  /** Жёсткий предел комнат процесса: дальше новые входы получают `busy`. */
  readonly maxRooms?: number;
  /**
   * Бюджет тика каждого шарда, мс: сумма сглаженных цен его комнат плюс цена новой не должна его
   * превышать (на тик отведено 100 мс, остальное — сборка мусора и запас на поздние стадии).
   */
  readonly budgetMs?: number;
  /** Цена комнаты до первых замеров, мс (поздние стадии дороже ранних, поэтому с запасом). */
  readonly roomEstimateMs?: number;
  /** Секунд с начала матча, пока можно подсесть на место бота; 0 — выключено. */
  readonly lateJoinSeconds?: number;
  /** Число воркеров-шардов; 0 или не задано — один встроенный шард в потоке шлюза. */
  readonly workers?: number;
  /** Предел кучи одного воркера, МБ. */
  readonly shardHeapMb?: number;
}

interface PendingJoin {
  readonly stage: 'reconnect' | 'join';
  readonly message: Extract<C2S, { t: 'hello' }>;
  readonly nick: string;
  readonly retried: boolean;
}

/** Одно соединение: разбор сообщений, лимиты и привязка к шарду. */
export class Session implements Connection {
  public readonly id: number;
  /** Адрес для лимитов; ключ учёта в хабе. */
  public readonly ip: string;
  public readonly createdAt: number;
  /** Шард, куда отправлен вход или где сидит игрок. */
  public shard: Shard | null = null;
  public pending: PendingJoin | null = null;
  public routed = false;
  public helloSeen = false;
  private readonly hub: Hub;
  private readonly out: Connection;
  private windowStart = 0;
  private windowCount = 0;
  private closed = false;

  public constructor(hub: Hub, out: Connection, ip: string, createdAt: number, id: number) {
    this.hub = hub;
    this.out = out;
    this.ip = ip;
    this.createdAt = createdAt;
    this.id = id;
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
      if (!this.helloSeen) this.hub.hello(this, message);
      return;
    }
    if (message.t === 'ping') {
      this.send(encodeServerMessage({ t: 'pong', at: message.at }));
      return;
    }
    if (this.routed && this.shard !== null) this.shard.message(this.id, message);
  }

  public onClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.shard?.closed(this.id);
    this.hub.release(this);
  }
}

export class Hub {
  private shards: Shard[] = [];
  private readonly byId = new Map<number, Session>();
  private nextConn = 1;
  private readonly now: () => number;
  private readonly size: number;
  private readonly settings: HostSettings;
  private readonly logger: NonNullable<HubOptions['log']>;
  private readonly maxRooms: number;
  private readonly budgetMs: number;
  private readonly roomEstimateMs: number;
  private readonly makeMap: (seed: number, size: number) => MapStatic;
  private readonly workers: number;
  private readonly heapMb: number;
  private readonly perIp = new Map<string, number>();
  private readonly hellos = new Map<string, { start: number; count: number }>();
  private readonly lag = monitorEventLoopDelay({ resolution: 10 });
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Дренаж перед выкладкой: новых людей и комнат не берём, идущие матчи доигрываются. */
  private draining = false;

  public constructor(options: HubOptions = {}) {
    this.now = options.now ?? Date.now;
    this.size = options.size ?? MATCH_SIZE;
    this.makeMap = options.makeMap ?? cachedMap;
    this.logger = options.log ?? (() => undefined);
    this.maxRooms = options.maxRooms ?? 24 * Math.max(1, options.workers ?? 0);
    this.budgetMs = options.budgetMs ?? 65;
    this.roomEstimateMs = options.roomEstimateMs ?? 8;
    this.workers = options.workers ?? 0;
    this.heapMb = options.shardHeapMb ?? 192;
    this.settings = {
      size: this.size,
      fog: options.fog ?? true,
      budgetMs: this.budgetMs,
      roomEstimateMs: this.roomEstimateMs,
      lateJoinTicks: (options.lateJoinSeconds ?? LATE_JOIN_TICKS / 10) * 10,
      seeds: QUICK_MATCH_SEEDS,
    };
    const count = Math.max(1, this.workers);
    for (let index = 0; index < count; index += 1) this.shards.push(this.makeShard(index));
  }

  private makeShard(index: number): Shard {
    const events: ShardEvents = {
      out: (conn, text) => {
        this.byId.get(conn)?.send(text);
      },
      close: (conn) => {
        const session = this.byId.get(conn);
        if (session === undefined) return;
        session.close();
        session.onClose();
      },
      joined: (conn, _roomId, ok) => {
        this.onJoined(index, conn, ok);
      },
      log: (event, data) => {
        this.log(event, data);
      },
      down: () => {
        this.onShardDown(index);
      },
    };
    const settings = { ...this.settings, seeds: this.seedsOf(index) };
    return this.workers > 0
      ? new WorkerShard(index, settings, events, this.heapMb)
      : new InlineShard(index, settings, events, this.now, this.makeMap);
  }

  /**
   * Сиды карт шарда: общий список делится между шардами, и каждый прогревает свою долю (меньше
   * памяти и работы на старте); при шардах больше сидов берётся весь список.
   */
  private seedsOf(index: number): readonly number[] {
    const count = Math.max(1, this.workers);
    const own = QUICK_MATCH_SEEDS.filter((_, i) => i % count === index);
    return own.length > 0 ? own : QUICK_MATCH_SEEDS;
  }

  /** Текущее время хаба, мс. */
  public clock(): number {
    return this.now();
  }

  public log(event: string, data?: Record<string, unknown>): void {
    this.logger(event, data);
  }

  /** Сводка для `/healthz`: комнаты, люди, цена тика, шарды, лаг I/O-потока, процессор и память. */
  public stats(): HubStats {
    const shards: ShardStats[] = this.shards.map((shard) => {
      const status = shard.status();
      return {
        index: shard.index,
        rooms: status.rooms.length,
        humans: status.humans,
        projectedMs: Math.round(status.projectedMs * 10) / 10,
        tickMs: status.tickMs,
        lateMs: status.lateMs,
        utilization: Math.round(status.utilization * 100) / 100,
        droppedTicks: status.droppedTicks,
        overloaded: status.overloaded,
      };
    });
    const cpu = process.cpuUsage();
    return {
      rooms: shards.reduce((s, x) => s + x.rooms, 0),
      humans: shards.reduce((s, x) => s + x.humans, 0),
      projectedMs: Math.round(shards.reduce((s, x) => s + x.projectedMs, 0) * 10) / 10,
      budgetMs: this.budgetMs * this.shards.length,
      tickMs: {
        p50: Math.max(...shards.map((x) => x.tickMs.p50)),
        p99: Math.max(...shards.map((x) => x.tickMs.p99)),
        max: Math.max(...shards.map((x) => x.tickMs.max)),
      },
      shards,
      ioLagMs: Number.isFinite(this.lag.max) ? this.lag.percentile(99) / 1e6 : 0,
      draining: this.draining,
      overloaded: shards.some((x) => x.overloaded),
      cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    };
  }

  /** Комната по id во встроенном шарде (тесты и отладка). */
  public roomById(id: string): Room | undefined {
    for (const shard of this.shards) {
      if (shard instanceof InlineShard) {
        const room = shard.room(id);
        if (room !== undefined) return room;
      }
    }
    return undefined;
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
    const session = new Session(this, out, ip, this.now(), this.nextConn);
    this.nextConn += 1;
    this.byId.set(session.id, session);
    return session;
  }

  /** Соединение закрылось: снимаем с учёта. */
  public release(session: Session): void {
    this.byId.delete(session.id);
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

  /** Все комнаты всех шардов по последним сводкам. */
  private directory(): { shard: Shard; room: RoomStatus }[] {
    const all: { shard: Shard; room: RoomStatus }[] = [];
    for (const shard of this.shards) {
      for (const room of shard.status().rooms) all.push({ shard, room });
    }
    return all;
  }

  private findRoom(id: string): { shard: Shard; room: RoomStatus } | undefined {
    // Код вводят руками: регистр не важен (id комнат — строчные).
    const wanted = id.toLowerCase();
    return this.directory().find((entry) => entry.room.id === wanted);
  }

  /** Обрабатывает `hello`: реконнект, приглашение, открытая комната, подсадка, закрытая комната. */
  public hello(session: Session, message: Extract<C2S, { t: 'hello' }>): void {
    session.helloSeen = true;
    if (!this.helloAllowed(session.ip)) return this.refuse(session, 'busy');
    if (message.v !== PROTOCOL_VERSION) return this.refuse(session, 'versionMismatch');
    const nick = sanitizeNick(message.nick);
    if (nick === null) return this.refuse(session, 'badNick');
    if (message.token !== undefined) {
      const found = this.findRoom(roomOfToken(message.token));
      if (found !== undefined) {
        session.shard = found.shard;
        session.pending = { stage: 'reconnect', message, nick, retried: false };
        found.shard.reconnect(session.id, found.room.id, message.token, message.have);
        return;
      }
    }
    // Дренаж: вернуться в свою игру можно, начать новую или подсесть — нет.
    if (this.draining) return this.refuse(session, 'busy');
    if (message.spectate === true && message.room === undefined) {
      return this.refuse(session, 'badHello');
    }
    this.joinNew(session, message, nick, false);
  }

  private joinNew(
    session: Session,
    message: Extract<C2S, { t: 'hello' }>,
    nick: string,
    retried: boolean,
  ): void {
    const target = this.pickRoom(session, message);
    if (target === null) return;
    session.shard = target.shard;
    session.pending = { stage: 'join', message, nick, retried };
    target.shard.join(session.id, target.roomId, nick, message.spectate === true);
  }

  /** Итог входа от шарда: привязка к комнате, либо повтор по свежей сводке, либо отказ. */
  private onJoined(shardIndex: number, conn: number, ok: boolean): void {
    const session = this.byId.get(conn);
    if (session === undefined) {
      // Игрок успел уйти: освобождаем только что занятое место.
      if (ok) this.shards[shardIndex]?.closed(conn);
      return;
    }
    const pending = session.pending;
    session.pending = null;
    if (ok) {
      session.routed = true;
      return;
    }
    session.shard = null;
    if (pending === null) return;
    if (pending.stage === 'reconnect') {
      this.joinNew(session, pending.message, pending.nick, false);
    } else if (pending.message.spectate === true) {
      this.refuse(session, 'notRunning');
    } else if (!pending.retried && pending.message.room === undefined) {
      // Сводка комнат могла устареть (место заняли только что): один повтор по новой.
      this.joinNew(session, pending.message, pending.nick, true);
    } else {
      this.refuse(session, 'roomFull');
    }
  }

  private pickRoom(
    session: Session,
    message: Extract<C2S, { t: 'hello' }>,
  ): { shard: Shard; roomId: string } | null {
    if (message.room !== undefined) {
      const found = this.findRoom(message.room);
      if (found === undefined) return this.refuseNull(session, 'noRoom');
      return { shard: found.shard, roomId: found.room.id };
    }
    if (message.mode === 'private') return this.place(session, 'private');
    // 1) открытый набор; 2) подсадка на место бота в самой заполненной идущей игре; 3) новая комната.
    const rooms = this.directory();
    for (const { shard, room } of rooms) {
      if (room.mode === 'open' && room.phase === 'lobby' && room.freeSeat) {
        return { shard, roomId: room.id };
      }
    }
    let fullest: { shard: Shard; room: RoomStatus } | null = null;
    for (const entry of rooms) {
      if (
        entry.room.canLateJoin &&
        (fullest === null || entry.room.connected > fullest.room.connected)
      ) {
        fullest = entry;
      }
    }
    if (fullest !== null) return { shard: fullest.shard, roomId: fullest.room.id };
    return this.place(session, 'open');
  }

  /**
   * Размещение новой комнаты: шард с наименьшей прогнозной ценой, если вместе с комнатой она
   * укладывается в бюджет тика шарда. Иначе игрок получает «сервер занят», идущие матчи не страдают.
   */
  private place(session: Session, mode: JoinMode): { shard: Shard; roomId: string } | null {
    const total = this.shards.reduce((sum, shard) => sum + shard.status().rooms.length, 0);
    let best: { shard: Shard; projected: number } | null = null;
    for (const shard of this.shards) {
      const status = shard.status();
      // Перегруженный шард (сбрасывался долг по времени или занятость выше 90%) новых комнат не получает.
      if (status.overloaded) continue;
      if (best === null || status.projectedMs < best.projected) {
        best = { shard, projected: status.projectedMs };
      }
    }
    if (
      best === null ||
      total >= this.maxRooms ||
      best.projected + this.roomEstimateMs > this.budgetMs
    ) {
      this.log('admissionRefused', { rooms: total, projectedMs: Math.round(best?.projected ?? 0) });
      this.refuse(session, 'busy');
      return null;
    }
    const roomId =
      mode === 'private' ? randomBytes(3).toString('hex') : `o${randomBytes(3).toString('hex')}`;
    // Карта берётся из готовых файлов клиента (быстрый матч): сид из общего списка.
    const seeds = this.seedsOf(best.shard.index);
    const seed = seeds[randomInt(0, seeds.length)] ?? 42;
    best.shard.create(roomId, mode, seed);
    return { shard: best.shard, roomId };
  }

  private refuse(session: Session, reason: RefuseReason): void {
    session.send(encodeServerMessage({ t: 'refused', reason }));
    session.close();
  }

  private refuseNull(session: Session, reason: RefuseReason): null {
    this.refuse(session, reason);
    return null;
  }

  /** Воркер шарда упал: игроков его комнат отключаем (они вернутся и получат новый вход), шард заводим заново. */
  private onShardDown(index: number): void {
    const dead = this.shards[index];
    if (dead === undefined) return;
    for (const session of [...this.byId.values()]) {
      if (session.shard === dead) session.kick('shardDown');
    }
    const replacement = this.makeShard(index);
    this.shards[index] = replacement;
    replacement.start();
  }

  /** Уборка шлюза: соединения без `hello` дольше срока закрываются. */
  public sweep(): void {
    const now = this.now();
    for (const session of [...this.byId.values()]) {
      if (!session.helloSeen && now - session.createdAt > HELLO_TIMEOUT_MS) session.kick('noHello');
    }
  }

  /** Один тик встроенных шардов и уборка (тесты и стенды с виртуальным временем). */
  public tickAll(): void {
    for (const shard of this.shards) if (shard instanceof InlineShard) shard.tick();
    this.sweep();
  }

  /** Запускает шарды и уборку шлюза. */
  public start(): void {
    if (this.sweepTimer !== null) return;
    this.lag.enable();
    for (const shard of this.shards) shard.start();
    this.sweepTimer = setInterval(() => {
      this.sweep();
    }, 1000);
    this.sweepTimer.unref();
  }

  /** Включает дренаж (сигнал SIGUSR2): выкладка ждёт, пока идущие матчи закончатся. */
  public drain(): void {
    this.draining = true;
    this.log('draining');
  }

  public stop(): void {
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    this.lag.disable();
    for (const shard of this.shards) shard.stop();
  }
}

/** Токен начинается с id комнаты: по нему находится комната без перебора. */
function roomOfToken(token: string): string {
  const index = token.indexOf('-');
  return index < 0 ? '' : token.slice(0, index);
}
