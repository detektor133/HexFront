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
/** Сколько тиков подряд хост догоняет после задержки; дальше пропускает, чтобы не копить долг. */
const MAX_CATCH_UP = 3;

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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;

  public constructor(options: HostOptions) {
    this.options = options;
  }

  /** Комната по id (тесты и отладка). */
  public room(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Создаёт комнату: id и сид выбирает шлюз, чтобы сразу знать, где она. */
  public create(roomId: string, mode: 'open' | 'private', seed: number): void {
    const { size, fog, now, lateJoinTicks } = this.options;
    const room = new Room({
      id: roomId,
      mode,
      map: this.options.makeMap(seed, size),
      mapName: 'gen',
      seed,
      size,
      fog,
      now,
      lateJoinTicks,
    });
    this.rooms.set(roomId, room);
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
  public join(conn: number, roomId: string, nick: string): void {
    const room = this.rooms.get(roomId);
    const ok = room !== undefined && room.join(this.connection(conn), nick) !== null;
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
    return { rooms, projectedMs: this.projectedMs(), tickMs: this.tickStats(), humans };
  }

  private tickStats(): TickStats {
    const used = this.samples.slice(0, Math.min(this.count, TICK_SAMPLES)).sort((a, b) => a - b);
    const pick = (p: number): number =>
      used[Math.min(used.length - 1, Math.floor(used.length * p))] ?? 0;
    return { p50: pick(0.5), p99: pick(0.99), max: used.at(-1) ?? 0 };
  }

  /** Один тик всех комнат хоста: набор, шаг, виды, уборка пустых и законченных. */
  public tick(): void {
    const startedAt = performance.now();
    const now = this.options.now();
    for (const [id, room] of this.rooms) {
      room.poll();
      room.tick();
      if (room.phase === 'ended') {
        room.close();
        this.rooms.delete(id);
        this.options.io.log('roomClosed', { room: id, ticks: room.stats.ticks });
        continue;
      }
      if (room.hasConnected()) this.emptySince.delete(id);
      else if (!this.emptySince.has(id)) this.emptySince.set(id, now);
      else if (now - (this.emptySince.get(id) ?? now) > ROOM_KEEP_MS) {
        room.close();
        this.rooms.delete(id);
        this.emptySince.delete(id);
        this.options.io.log('roomDropped', { room: id });
      }
    }
    this.samples[this.count % TICK_SAMPLES] = performance.now() - startedAt;
    this.count += 1;
  }

  /** Запускает тики 10 Гц; следующий запуск считается от плана, а не от конца прошлого. */
  public start(afterTick?: () => void): void {
    if (this.timer !== null) return;
    this.nextAt = performance.now() + TICK_MS;
    const loop = (): void => {
      let ran = 0;
      while (performance.now() >= this.nextAt && ran < MAX_CATCH_UP) {
        this.tick();
        afterTick?.();
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
    this.conns.clear();
    this.where.clear();
  }
}
