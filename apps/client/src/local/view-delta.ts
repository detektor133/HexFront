import {
  applyViewDelta,
  buildViewDelta,
  canBuildViewDelta,
  paceView,
  ProtocolError,
  SLOW_PERIOD_TICKS,
  type DeltaMessage,
  type SnapshotMessage,
} from '@hexfront/protocol';
import type { GameEvent, PlanView, PlayerView, UnitView } from '@hexfront/sim';

export { buildViewDelta, canBuildViewDelta };

export type FullSnapshotReason = 'start' | 'view' | 'fog';
type ViewEvent = GameEvent;

export type ViewTransport =
  | { readonly kind: 'snapshot'; readonly snapshot: SnapshotMessage }
  | { readonly kind: 'delta'; readonly delta: DeltaMessage };

export class ConfirmedViewDeltaStream {
  private confirmed: PlayerView | null = null;
  private sent: PlayerView | null = null;
  private waiting = false;
  private forceFull = true;
  private slowSyncedAt = 0;

  public requestFull(): void {
    this.forceFull = true;
  }

  public reset(): void {
    this.confirmed = null;
    this.sent = null;
    this.waiting = false;
    this.forceFull = true;
  }

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

  public acknowledge(): void {
    if (this.sent === null) return;
    this.confirmed = this.sent;
    this.sent = null;
    this.waiting = false;
  }
}

function cloneView(view: PlayerView): PlayerView {
  return {
    ...view,
    hexes: {
      owner: view.hexes.owner.slice(),
      pop: view.hexes.pop.slice(),
      improvement: view.hexes.improvement.slice(),
      building: view.hexes.building.slice(),
      road: view.hexes.road.slice(),
      link: view.hexes.link.slice(),
      growth: view.hexes.growth.slice(),
      visible: view.hexes.visible.slice(),
    },
  };
}

export class ViewDeltaApplier {
  private currentView: PlayerView | null = null;
  private pendingFullSnapshot = false;
  private readonly requestedEvents: ViewEvent[] = [];
  private readonly requestSnapshot: (reason: FullSnapshotReason) => void;

  public constructor(requestSnapshot: (reason: FullSnapshotReason) => void = () => undefined) {
    this.requestSnapshot = requestSnapshot;
    this.requestFullSnapshot('start');
  }

  public get view(): PlayerView | null {
    return this.currentView;
  }

  public get events(): readonly ViewEvent[] {
    return this.requestedEvents;
  }

  public applySnapshot(message: SnapshotMessage): PlayerView {
    this.currentView = cloneView(message.view);
    this.pendingFullSnapshot = false;
    return this.currentView;
  }

  public applyDelta(message: DeltaMessage): PlayerView {
    const view = this.currentView;
    if (view === null || this.pendingFullSnapshot) {
      throw new ProtocolError('Ожидался полный снимок перед дельтой');
    }
    if (message.tick <= view.tick) return view;
    if (message.baseTick !== view.tick) throw new ProtocolError('Неверная база дельты');
    this.currentView = applyViewDelta(view, message);
    this.requestedEvents.push(...message.d.events);
    return this.currentView;
  }

  public requestViewChange(): void {
    this.requestFullSnapshot('view');
  }

  public requestFogChange(): void {
    this.requestFullSnapshot('fog');
  }

  private requestFullSnapshot(reason: FullSnapshotReason): void {
    if (this.pendingFullSnapshot) return;
    this.pendingFullSnapshot = true;
    this.requestSnapshot(reason);
  }
}

export type { PlanView, UnitView };
