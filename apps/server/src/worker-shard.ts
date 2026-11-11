// Шард в воркере (worker_threads), со стороны шлюза: пересылка сообщений пачками и сводки комнат.
import { Worker } from 'node:worker_threads';

import type { C2S, JoinMode } from '@hexfront/protocol';

import type {
  FromShard,
  HostSettings,
  RoomStatus,
  ShardStatus,
  ToShard,
} from './shard-protocol.ts';
import type { Shard, ShardEvents } from './shard.ts';

const EMPTY: ShardStatus = {
  rooms: [],
  projectedMs: 0,
  tickMs: { p50: 0, p99: 0, max: 0 },
  humans: 0,
};

export class WorkerShard implements Shard {
  public readonly index: number;
  private readonly settings: HostSettings;
  private readonly events: ShardEvents;
  private readonly heapMb: number;
  private worker: Worker | null = null;
  private cached: ShardStatus = EMPTY;
  /** Созданные, но ещё не попавшие в сводку комнаты: шлюз сразу видит их и не плодит лишние. */
  private readonly pending = new Map<string, RoomStatus>();
  private outbox: ToShard[] = [];
  private flushQueued = false;
  private stopped = false;

  public constructor(index: number, settings: HostSettings, events: ShardEvents, heapMb: number) {
    this.index = index;
    this.settings = settings;
    this.events = events;
    this.heapMb = heapMb;
  }

  /** Запускает поток шарда. */
  public start(): void {
    if (this.worker !== null) return;
    const worker = new Worker(new URL('./shard-worker.ts', import.meta.url), {
      workerData: { settings: this.settings, index: this.index },
      resourceLimits: { maxOldGenerationSizeMb: this.heapMb, maxYoungGenerationSizeMb: 8 },
    });
    this.worker = worker;
    worker.on('message', (message: FromShard) => {
      this.receive(message);
    });
    worker.on('error', (error) => {
      this.events.log('shardError', { shard: this.index, error: String(error) });
    });
    worker.on('exit', (code) => {
      this.worker = null;
      if (!this.stopped) {
        this.events.log('shardExit', { shard: this.index, code });
        this.events.down();
      }
    });
  }

  private receive(message: FromShard): void {
    switch (message.k) {
      case 'out':
        for (const [conn, text] of message.batch) this.events.out(conn, text);
        break;
      case 'close':
        for (const conn of message.conns) this.events.close(conn);
        break;
      case 'joined':
        this.events.joined(message.conn, message.roomId, message.ok);
        break;
      case 'status':
        this.cached = message.status;
        for (const room of message.status.rooms) this.pending.delete(room.id);
        break;
      case 'log':
        this.events.log(message.event, message.data);
        break;
    }
  }

  /** Сообщения шарду копятся и уходят одним postMessage в конце оборота цикла событий. */
  private post(message: ToShard): void {
    this.outbox.push(message);
    if (this.flushQueued) return;
    this.flushQueued = true;
    setImmediate(() => {
      this.flushQueued = false;
      const batch = this.outbox;
      this.outbox = [];
      this.worker?.postMessage(batch);
    });
  }

  public create(roomId: string, mode: JoinMode, seed: number): void {
    this.pending.set(roomId, {
      id: roomId,
      mode,
      phase: 'lobby',
      connected: 0,
      freeSeat: true,
      canLateJoin: false,
      costMs: 0,
    });
    this.post({ k: 'create', roomId, mode, seed });
  }

  public join(conn: number, roomId: string, nick: string): void {
    this.post({ k: 'join', conn, roomId, nick });
  }

  public reconnect(conn: number, roomId: string, token: string, have?: number): void {
    this.post({ k: 'reconnect', conn, roomId, token, ...(have === undefined ? {} : { have }) });
  }

  public message(conn: number, message: C2S): void {
    this.post({ k: 'c2s', conn, m: message });
  }

  public closed(conn: number): void {
    this.post({ k: 'closed', conn });
  }

  public status(): ShardStatus {
    if (this.pending.size === 0) return this.cached;
    const rooms = [...this.cached.rooms, ...this.pending.values()];
    return {
      ...this.cached,
      rooms,
      projectedMs: this.cached.projectedMs + this.pending.size * this.settings.roomEstimateMs,
    };
  }

  public stop(): void {
    this.stopped = true;
    this.post({ k: 'stop' });
    const worker = this.worker;
    if (worker !== null) setTimeout(() => void worker.terminate(), 200);
  }
}
