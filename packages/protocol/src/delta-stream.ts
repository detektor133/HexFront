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

export class ConfirmedViewDeltaStream {
  private confirmed: PlayerView | null = null;
  private sent: PlayerView | null = null;
  private waiting = false;
  private forceFull = true;
  private slowSyncedAt = 0;

  /** Следующее сообщение будет полным снимком (вход, реконнект, смена вида или тумана). */
  public requestFull(): void {
    this.forceFull = true;
  }

  /** Забывает базу: после этого первым уйдёт полный снимок. */
  public reset(): void {
    this.confirmed = null;
    this.sent = null;
    this.waiting = false;
    this.forceFull = true;
  }

  /** Ждём `viewAck` на уже отправленное сообщение. */
  public get isWaiting(): boolean {
    return this.waiting;
  }

  /** Подтверждённый клиентом вид; по нему сервер строит `slowLayerReuse`. */
  public get confirmedView(): PlayerView | null {
    return this.confirmed;
  }

  /** Нужен ли на этом тике срок синхронизации медленных слоёв (для `slowLayerReuse`). */
  public isSlowSync(tick: number): boolean {
    return this.confirmed === null || tick - this.slowSyncedAt >= SLOW_PERIOD_TICKS;
  }

  /**
   * Следующее сообщение получателю.
   * @returns снимок или дельта; `null`, если предыдущее ещё не подтверждено
   */
  public next(view: PlayerView, events: readonly GameEvent[]): ViewTransport | null {
    if (this.waiting) return null;
    const full =
      this.forceFull || this.confirmed === null || !canBuildViewDelta(this.confirmed, view);
    let transport: ViewTransport;
    let sent: PlayerView;
    if (full || this.confirmed === null) {
      transport = { kind: 'snapshot', snapshot: { t: 'snapshot', tick: view.tick, view } };
      sent = view;
      this.slowSyncedAt = view.tick;
    } else {
      // Медленные поля обновляются раз в SLOW_PERIOD_TICKS; базой дальше станет именно «клиентский» вид.
      const sync = view.tick - this.slowSyncedAt >= SLOW_PERIOD_TICKS;
      if (sync) this.slowSyncedAt = view.tick;
      sent = paceView(this.confirmed, view, sync);
      transport = { kind: 'delta', delta: buildViewDelta(this.confirmed, sent, events) };
    }
    this.forceFull = false;
    this.sent = sent;
    this.waiting = true;
    return transport;
  }

  /** Клиент применил последнее сообщение: оно становится базой. */
  public acknowledge(): void {
    if (this.sent === null) return;
    this.confirmed = this.sent;
    this.sent = null;
    this.waiting = false;
  }
}
