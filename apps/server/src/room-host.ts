// Хост комнат одного потока: ведёт много комнат, тикает их и отвечает шлюзу сводками.
// Не знает ни про сокеты, ни про потоки: вывод идёт через `HostIo`, ввод — вызовами методов.
// Один и тот же хост работает внутри I/O-потока (тесты, разработка) и в воркере (боевой режим).
import type { C2S } from '@hexfront/protocol';
import { TICK_MS, type MapStatic } from '@hexfront/sim';

import { Room, type Connection } from './room.ts';
import type { HostSettings, RoomStatus, ShardStatus, TickStats } from './shard-protocol.ts';

/** Закрытая комната без людей живёт дольше открытой, но не вечно. */
const ROOM_KEEP_MS = 60_000;
const TICK_SAMPLES = 600;
/**
 * Долг комнаты по времени, мс: пока комната отстаёт меньше, её тики идут подряд без пауз (догоняют
 * план); больше — долг сбрасывается, игра в комнате идёт медленнее реального времени. Лавина
 * догоняющих тиков только удлинила бы перегруз.
 */
const MAX_DEBT_MS = 300;
/** Сколько мс подряд хост тикает комнаты, прежде чем отдать цикл событий (acks, команды, вход). */
const SLICE_MS = 20;
/** Окно, в котором сброшенный долг считается признаком перегруза шарда, мс. */
const OVERLOAD_WINDOW_MS = 30_000;

/** Куда хост отдаёт результат: тексты игрокам, закрытие соединений, итог входа, журнал. */
export interface HostIo {
  out(conn: number, text: string): void;
  close(conn: number): void;
  joined(conn: number, roomId: string, ok: boolean): void;
  log(event: string, data?: Record<string, unknown>): void;
}

export interface HostOptions extends HostSettings {
  readonly now: () => number;
  readonly makeMap: (seed: number, size: number) => MapStatic;
  readonly io: HostIo;
}

export class RoomHost {
  private readonly rooms = new Map<string, Room>();
  private readonly conns = new Map<number, Connection>();
  /** В какой комнате сидит соединение: сообщения игрока идут без перебора комнат. */
  private readonly where = new Map<number, Room>();
  private readonly emptySince = new Map<string, number>();
  private readonly options: HostOptions;
  private readonly samples = new Float64Array(TICK_SAMPLES);
  private count = 0;
  /** Опоздание начала тика относительно плана: растёт, когда поток не успевает. */
  private readonly late = new Float64Array(TICK_SAMPLES);
  private lateCount = 0;
  /** Срок следующего тика каждой комнаты (performance.now, мс): свой ритм и свой фазовый сдвиг. */
  private readonly dueAt = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busyMs = 0;
  private utilFrom = performance.now();
  private utilLast = 0;
  private readonly drops: number[] = [];
  private droppedTotal = 0;

  public constructor(options: HostOptions) {
    this.options = options;
  }

  /** Комната по id (тесты и отладка). */
  public room(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Создаёт комнату: id и сид выбирает шлюз, чтобы сразу знать, где она. */
  public create(roomId: string, mode: 'open' | 'private', seed: number): void {
    const { size, fog, now, lateJoinTicks, placeSeconds } = this.options;
    const room = new Room({
      id: roomId,
      mode,
      map: this.options.makeMap(seed, size),
      mapName: 'gen',
      makeMap: this.options.makeMap,
      seed,
      size,
      fog,
      now,
      lateJoinTicks,
      ...(placeSeconds === undefined ? {} : { placeSeconds }),
    });
    this.rooms.set(roomId, room);
    // Первый тик через период от создания: фазы комнат разнесены по времени, а не сходятся в один миг.
    this.dueAt.set(roomId, performance.now() + TICK_MS);
    this.options.io.log('roomCreated', { room: roomId, mode });
  }

  private connection(id: number): Connection {
    let conn = this.conns.get(id);
    if (conn === undefined) {
      const io = this.options.io;
      conn = {
        send: (text) => {
          io.out(id, text);
        },
        close: () => {
          io.close(id);
        },
      };
      this.conns.set(id, conn);
    }
    return conn;
  }

  /** Сажает игрока в комнату; итог — `io.joined`. */
  public join(conn: number, roomId: string, nick: string, spectate = false): void {
    const room = this.rooms.get(roomId);
    const ok =
      room !== undefined &&
      (spectate
        ? room.spectate(this.connection(conn), nick)
        : room.join(this.connection(conn), nick)) !== null;
    if (ok && room !== undefined) {
      this.where.set(conn, room);
      this.options.io.log('join', { room: roomId, humans: room.humans });
    } else this.conns.delete(conn);
    this.options.io.joined(conn, roomId, ok);
  }

  /** Возвращает игрока на его место по токену; итог — `io.joined`. */
  public reconnect(conn: number, roomId: string, token: string, have?: number): void {
    const room = this.rooms.get(roomId);
    const ok = room !== undefined && room.reconnect(this.connection(conn), token, have) !== null;
    if (ok && room !== undefined) this.where.set(conn, room);
    else this.conns.delete(conn);
    this.options.io.joined(conn, roomId, ok);
  }

  /** Проверенное сообщение игрока: команда, подтверждение вида, запрос карточки и т. п. */
  public message(conn: number, message: C2S): void {
    const connection = this.conns.get(conn);
    const room = this.where.get(conn);
    if (connection === undefined || room === undefined) return;
    switch (message.t) {
      case 'cmd':
        room.command(connection, message.seq, message.cmd);
        break;
      case 'resync':
        room.resync(connection);
        break;
      case 'select':
        room.select(connection, message.hex);
        break;
      case 'query':
        room.query(connection, message.id, message.q);
        break;
      case 'viewAck':
        room.viewAck(connection, message.tick);
        break;
      case 'start':
        room.startEarly(connection);
        break;
      case 'configure':
        room.configure(connection, {
          ...(message.level === undefined ? {} : { level: message.level }),
          ...(message.map === undefined ? {} : { map: message.map }),
          ...(message.players === undefined ? {} : { players: message.players }),
          ...(message.seed === undefined ? {} : { seed: message.seed }),
          ...(message.genSpawns === undefined ? {} : { genSpawns: message.genSpawns }),
        });
        break;
      case 'ready':
        room.setReady(connection, message.ready);
        break;
      case 'transfer':
        room.transfer(connection, message.to);
        break;
      case 'pick':
        room.pick(connection, message.spawn);
        break;
      case 'rematch':
        room.rematch(connection);
        break;
      case 'chat':
        room.chat(connection, {
          ...(message.text === undefined ? {} : { text: message.text }),
          ...(message.emoji === undefined ? {} : { emoji: message.emoji }),
          ...(message.to === undefined ? {} : { to: message.to }),
        });
        break;
      case 'mark':
        room.mark(connection, message.hex, message.kind);
        break;
      case 'watch':
        room.watch(connection, message.player);
        break;
      default:
        break;
    }
  }

  /** Соединение закрылось: место в лобби освобождается, в матче держится на реконнект. */
  public closed(conn: number): void {
    const connection = this.conns.get(conn);
    const room = this.where.get(conn);
    if (connection !== undefined && room !== undefined) room.disconnect(connection);
    this.conns.delete(conn);
    this.where.delete(conn);
  }

  /** Сколько мс на тик займут комнаты хоста: идущие — по замеру, наборы — по средней оценке. */
  public projectedMs(): number {
    const estimate = this.options.roomEstimateMs;
    const measured = [...this.rooms.values()].filter((r) => r.phase === 'running' && r.costMs > 0);
    const average =
      measured.length === 0
        ? estimate
        : Math.max(estimate, measured.reduce((s, r) => s + r.costMs, 0) / measured.length);
    let sum = 0;
    for (const room of this.rooms.values()) {
      sum += room.phase === 'running' && room.costMs > 0 ? room.costMs : average;
    }
    return sum;
  }

  public status(): ShardStatus {
    const rooms: RoomStatus[] = [];
    let humans = 0;
    for (const room of this.rooms.values()) {
      humans += room.connected;
      rooms.push({
        id: room.id,
        mode: room.mode,
        phase: room.phase,
        connected: room.connected,
        freeSeat: room.hasFreeSeat,
        canLateJoin: room.canLateJoin,
        costMs: room.costMs,
      });
    }
    const utilization = this.utilization();
    return {
      rooms,
      projectedMs: this.projectedMs(),
      tickMs: stats(this.samples, this.count),
      lateMs: stats(this.late, this.lateCount),
      utilization,
      droppedTicks: this.droppedTotal,
      overloaded: this.recentDrops() > 0 || utilization > 0.9,
      humans,
    };
  }

  /** Доля времени потока, занятая тиками комнат, за последние секунды. */
  private utilization(): number {
    const now = performance.now();
    const span = now - this.utilFrom;
    if (span >= 2000) {
      this.utilLast = this.busyMs / span;
      this.busyMs = 0;
      this.utilFrom = now;
    }
    return this.utilLast;
  }

  private recentDrops(): number {
    const edge = performance.now() - OVERLOAD_WINDOW_MS;
    while (this.drops.length > 0 && (this.drops[0] ?? 0) < edge) this.drops.shift();
    return this.drops.length;
  }

  /** Тик одной комнаты: набор, шаг, виды, уборка пустой или законченной. */
  private tickRoom(id: string, room: Room): void {
    const now = this.options.now();
    room.poll();
    room.tick();
    if (room.phase === 'ended' && !room.rematchable) {
      room.close();
      this.rooms.delete(id);
      this.dueAt.delete(id);
      this.options.io.log('roomClosed', { room: id, ticks: room.stats.ticks });
      return;
    }
    if (room.hasConnected()) this.emptySince.delete(id);
    else if (!this.emptySince.has(id)) this.emptySince.set(id, now);
    else if (now - (this.emptySince.get(id) ?? now) > ROOM_KEEP_MS) {
      room.close();
      this.rooms.delete(id);
      this.dueAt.delete(id);
      this.emptySince.delete(id);
      this.options.io.log('roomDropped', { room: id });
    }
  }

  /** Один тик всех комнат сразу (тесты и стенды с виртуальным временем; без расписания). */
  public tick(): void {
    for (const [id, room] of this.rooms) {
      const started = performance.now();
      this.tickRoom(id, room);
      this.samples[this.count % TICK_SAMPLES] = performance.now() - started;
      this.count += 1;
    }
  }

  /**
   * Запускает расписание: у каждой комнаты свой срок и свой ритм 10 Гц. Самые просроченные идут первыми,
   * поэтому при перегрузе время делится честно, а один тяжёлый тик задерживает соседей только на его длину.
   * `flush` вызывается после каждой комнаты (исходящие уходят сразу), `afterPass` — после порции.
   */
  public start(flush?: () => void, afterPass?: () => void): void {
    if (this.timer !== null) return;
    const loop = (): void => {
      this.timer = null;
      const sliceStart = performance.now();
      const due = [...this.rooms.entries()]
        .filter(([id]) => (this.dueAt.get(id) ?? Infinity) <= sliceStart)
        .sort((x, y) => (this.dueAt.get(x[0]) ?? 0) - (this.dueAt.get(y[0]) ?? 0));
      for (const [id, room] of due) {
        if (!this.rooms.has(id)) continue;
        const planned = this.dueAt.get(id) ?? sliceStart;
        const started = performance.now();
        this.late[this.lateCount % TICK_SAMPLES] = Math.max(0, started - planned);
        this.lateCount += 1;
        this.tickRoom(id, room);
        const finished = performance.now();
        this.samples[this.count % TICK_SAMPLES] = finished - started;
        this.count += 1;
        this.busyMs += finished - started;
        // Следующий срок считается от плана, а не от конца тика; слишком большой долг сбрасывается.
        let next = planned + TICK_MS;
        if (next < finished - MAX_DEBT_MS) {
          next = finished;
          this.drops.push(finished);
          this.droppedTotal += 1;
          this.options.io.log('ticksDropped', { room: id });
        }
        if (this.rooms.has(id)) this.dueAt.set(id, next);
        flush?.();
        if (performance.now() - sliceStart > SLICE_MS) break;
      }
      afterPass?.();
      let soonest = Infinity;
      for (const value of this.dueAt.values()) soonest = Math.min(soonest, value);
      const delay = Number.isFinite(soonest) ? Math.max(0, soonest - performance.now()) : TICK_MS;
      this.timer = setTimeout(loop, delay);
    };
    this.timer = setTimeout(loop, TICK_MS);
  }

  public stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
    this.dueAt.clear();
    this.conns.clear();
    this.where.clear();
  }
}

/** Квантили по кольцевому буферу замеров. */
function stats(buffer: Float64Array, count: number): TickStats {
  const used = buffer.slice(0, Math.min(count, buffer.length)).sort((x, y) => x - y);
  const pick = (p: number): number =>
    used[Math.min(used.length - 1, Math.floor(used.length * p))] ?? 0;
  return { p50: pick(0.5), p99: pick(0.99), max: used.at(-1) ?? 0 };
}
