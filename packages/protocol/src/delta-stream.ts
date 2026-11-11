// Поток дельт одного получателя: база следующей дельты — только подтверждённый клиентом вид.
// Используется локальным воркером и сервером комнаты, поэтому живёт в протоколе.
import type { GameEvent, PlayerView } from '@hexfront/sim';

import type { SnapshotMessage } from './snapshot-message.ts';
import {
  buildViewDelta,
  canBuildViewDelta,
  paceView,
  SLOW_PERIOD_TICKS,
  type DeltaMessage,
} from './view-delta.ts';

export type ViewTransport =
  | { readonly kind: 'snapshot'; readonly snapshot: SnapshotMessage }
  | { readonly kind: 'delta'; readonly delta: DeltaMessage };

interface InFlight {
  readonly view: PlayerView;
  readonly events: readonly GameEvent[];
}

/**
 * Поток дельт получателя с окном: до `window` сообщений в пути без ожидания подтверждения.
 * Окно 1 — локальный воркер (отправка после `ack`); сервер ставит окно больше, чтобы при пинге
 * сотни миллисекунд вид шёл на каждом тике, а не раз в круговую задержку. Канал упорядочен (TCP),
 * поэтому следующая дельта строится от последнего отправленного вида, а не от подтверждённого.
 */
export class ConfirmedViewDeltaStream {
  private confirmed: PlayerView | null = null;
  private flight: InFlight[] = [];
  private forceFull = true;
  private slowSyncedAt = 0;
  private readonly window: number;

  public constructor(window = 1) {
    this.window = Math.max(1, window);
  }

  /** Следующее сообщение будет полным снимком (вход, реконнект, смена вида или тумана). */
  public requestFull(): void {
    this.forceFull = true;
  }

  /** Забывает базу: после этого первым уйдёт полный снимок. */
  public reset(): void {
    this.confirmed = null;
    this.flight = [];
    this.forceFull = true;
  }

  /**
   * Продолжает поток после обрыва связи: клиент назвал тик последнего применённого вида.
   * @returns `how`: `'sent'` — клиент применил что-то из отправленного (потерялись только `viewAck`),
   * `'confirmed'` — отправленное не дошло; `events` — события неприменённых сообщений, их надо
   * отправить заново; `null` — такой базы нет, нужен полный снимок (поток сброшен)
   */
  public resume(have: number): { how: 'sent' | 'confirmed'; events: GameEvent[] } | null {
    if (this.confirmed !== null && this.confirmed.tick === have) {
      const events = this.flight.flatMap((item) => [...item.events]);
      this.flight = [];
      this.forceFull = false;
      return { how: 'confirmed', events };
    }
    const index = this.flight.findIndex((item) => item.view.tick === have);
    if (index < 0) {
      this.reset();
      return null;
    }
    const events = this.flight.slice(index + 1).flatMap((item) => [...item.events]);
    this.confirmed = (this.flight[index] as InFlight).view;
    this.flight = [];
    this.forceFull = false;
    return { how: 'sent', events };
  }

  /** Следующим уйдёт полный снимок (вход, реконнект, сброс базы): он в разы тяжелее дельты. */
  public get willSendSnapshot(): boolean {
    return this.forceFull || this.baseView === null;
  }

  /** Окно отправки заполнено: ждём `viewAck`. */
  public get isWaiting(): boolean {
    return this.flight.length >= this.window;
  }

  /** Вид, от которого строится следующая дельта (последний отправленный); по нему `slowLayerReuse`. */
  public get baseView(): PlayerView | null {
    return this.flight.at(-1)?.view ?? this.confirmed;
  }

  /** Нужен ли на этом тике срок синхронизации медленных слоёв (для `slowLayerReuse`). */
  public isSlowSync(tick: number): boolean {
    return this.baseView === null || tick - this.slowSyncedAt >= SLOW_PERIOD_TICKS;
  }

  /**
   * Следующее сообщение получателю.
   * @returns снимок или дельта; `null`, если окно отправки заполнено
   */
  public next(view: PlayerView, events: readonly GameEvent[]): ViewTransport | null {
    if (this.isWaiting) return null;
    const base = this.baseView;
    const full = this.forceFull || base === null || !canBuildViewDelta(base, view);
    let transport: ViewTransport;
    if (full || base === null) {
      transport = { kind: 'snapshot', snapshot: { t: 'snapshot', tick: view.tick, view } };
      this.flight = [{ view, events: [] }];
      this.slowSyncedAt = view.tick;
    } else {
      // Медленные поля обновляются раз в SLOW_PERIOD_TICKS; базой дальше станет именно «клиентский» вид.
      const sync = view.tick - this.slowSyncedAt >= SLOW_PERIOD_TICKS;
      if (sync) this.slowSyncedAt = view.tick;
      const sent = paceView(base, view, sync);
      transport = { kind: 'delta', delta: buildViewDelta(base, sent, events) };
      this.flight.push({ view: sent, events });
    }
    this.forceFull = false;
    return transport;
  }

  /**
   * Клиент применил сообщение: оно и всё до него становятся подтверждённой базой.
   * Без аргумента подтверждается последнее отправленное (окно 1, локальный воркер).
   */
  public acknowledge(tick?: number): void {
    const last = this.flight.at(-1);
    if (last === undefined) return;
    const target = tick ?? last.view.tick;
    const index = this.flight.findIndex((item) => item.view.tick === target);
    if (index < 0) return;
    this.confirmed = (this.flight[index] as InFlight).view;
    this.flight.splice(0, index + 1);
  }
}
