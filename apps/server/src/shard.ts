// Шард со стороны шлюза: интерфейс и встроенная реализация (хост комнат в том же потоке).
// Боевая реализация в воркере — worker-shard.ts; контракт один, поэтому логика шлюза не знает,
// где живут комнаты.
import type { C2S, JoinMode } from '@hexfront/protocol';
import type { MapStatic } from '@hexfront/sim';

import { RoomHost } from './room-host.ts';
import type { Room } from './room.ts';
import type { HostSettings, ShardStatus } from './shard-protocol.ts';

/** События шарда для шлюза. */
export interface ShardEvents {
  out(conn: number, text: string): void;
  close(conn: number): void;
  joined(conn: number, roomId: string, ok: boolean): void;
  log(event: string, data?: Record<string, unknown>): void;
  /** Поток шарда упал: его комнаты потеряны, соединения надо закрыть. */
  down(): void;
}

export interface Shard {
  readonly index: number;
  create(roomId: string, mode: JoinMode, seed: number): void;
  join(conn: number, roomId: string, nick: string): void;
  reconnect(conn: number, roomId: string, token: string, have?: number): void;
  message(conn: number, message: C2S): void;
  closed(conn: number): void;
  status(): ShardStatus;
  start(): void;
  stop(): void;
}

/** Встроенный шард: хост комнат в потоке шлюза. Для тестов, стендов и режима «без воркеров». */
export class InlineShard implements Shard {
  public readonly index: number;
  private readonly host: RoomHost;

  public constructor(
    index: number,
    settings: HostSettings,
    events: ShardEvents,
    now: () => number,
    makeMap: (seed: number, size: number) => MapStatic,
  ) {
    this.index = index;
    this.host = new RoomHost({
      ...settings,
      now,
      makeMap,
      io: {
        out: (conn, text) => {
          events.out(conn, text);
        },
        close: (conn) => {
          events.close(conn);
        },
        joined: (conn, roomId, ok) => {
          events.joined(conn, roomId, ok);
        },
        log: (event, data) => {
          events.log(event, data);
        },
      },
    });
  }

  public create(roomId: string, mode: JoinMode, seed: number): void {
    this.host.create(roomId, mode, seed);
  }

  public join(conn: number, roomId: string, nick: string): void {
    this.host.join(conn, roomId, nick);
  }

  public reconnect(conn: number, roomId: string, token: string, have?: number): void {
    this.host.reconnect(conn, roomId, token, have);
  }

  public message(conn: number, message: C2S): void {
    this.host.message(conn, message);
  }

  public closed(conn: number): void {
    this.host.closed(conn);
  }

  public status(): ShardStatus {
    return this.host.status();
  }

  public start(): void {
    this.host.start();
  }

  public stop(): void {
    this.host.stop();
  }

  /** Один тик синхронно (тесты и стенды с виртуальным временем). */
  public tick(): void {
    this.host.tick();
  }

  /** Комната по id (тесты и отладка). */
  public room(id: string): Room | undefined {
    return this.host.room(id);
  }
}
