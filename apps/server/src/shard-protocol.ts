// Протокол между I/O-потоком (шлюз) и шардами. Шард — поток, который ведёт много комнат.
// Соединение у шарда — число (`conn`): сокеты остаются в I/O-потоке, в шард идут уже проверенные
// сообщения, а исходящие тексты возвращаются пачкой за тик (одно postMessage вместо сотен).
import type { C2S, JoinMode } from '@hexfront/protocol';

/** Сообщение шлюза шарду. */
export type ToShard =
  | {
      readonly k: 'create';
      readonly roomId: string;
      readonly mode: JoinMode;
      readonly seed: number;
    }
  | {
      readonly k: 'join';
      readonly conn: number;
      readonly roomId: string;
      readonly nick: string;
      readonly spectate?: boolean;
    }
  | {
      readonly k: 'reconnect';
      readonly conn: number;
      readonly roomId: string;
      readonly token: string;
      readonly have?: number;
    }
  /** Проверенное сообщение игрока уже внутри комнаты (не `hello` и не `ping`). */
  | { readonly k: 'c2s'; readonly conn: number; readonly m: C2S }
  | { readonly k: 'closed'; readonly conn: number }
  | { readonly k: 'stop' };

/** Сводка комнаты для шлюза: по ней он выбирает, куда посадить игрока и можно ли создать комнату. */
export interface RoomStatus {
  readonly id: string;
  readonly mode: JoinMode;
  readonly phase: 'lobby' | 'running' | 'ended';
  /** Людей с живым соединением. */
  readonly connected: number;
  readonly freeSeat: boolean;
  readonly canLateJoin: boolean;
  /** Сглаженная цена тика комнаты, мс; 0 — не измерена. */
  readonly costMs: number;
}

export interface TickStats {
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
}

/** Сводка шарда: комнаты, прогноз суммы цен, время тика. */
export interface ShardStatus {
  readonly rooms: readonly RoomStatus[];
  readonly projectedMs: number;
  /** Длительность тика одной комнаты, мс. */
  readonly tickMs: TickStats;
  /** Опоздание начала тика относительно плана, мс: растёт, когда поток не успевает. */
  readonly lateMs: TickStats;
  /** Доля времени потока, занятая тиками (0..1). */
  readonly utilization: number;
  /** Тиков, чей долг по времени сброшен (игра в комнате шла медленнее реального времени). */
  readonly droppedTicks: number;
  /** Шард перегружен: недавно сбрасывался долг или занятость выше 90%; новые комнаты ему не даются. */
  readonly overloaded: boolean;
  readonly humans: number;
}

/** Сообщение шарда шлюзу. */
export type FromShard =
  | { readonly k: 'out'; readonly batch: readonly (readonly [number, string])[] }
  | { readonly k: 'close'; readonly conns: readonly number[] }
  | { readonly k: 'joined'; readonly conn: number; readonly roomId: string; readonly ok: boolean }
  | { readonly k: 'status'; readonly status: ShardStatus }
  | { readonly k: 'log'; readonly event: string; readonly data?: Record<string, unknown> };

/** Настройки хоста комнат; в воркер уходят через `workerData`. */
export interface HostSettings {
  readonly size: number;
  readonly fog: boolean;
  readonly budgetMs: number;
  readonly roomEstimateMs: number;
  /** Тиков с начала матча, пока можно подсесть на место бота. */
  readonly lateJoinTicks: number;
}
