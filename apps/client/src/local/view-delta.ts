import {
  applyViewDelta,
  buildViewDelta,
  canBuildViewDelta,
  ConfirmedViewDeltaStream,
  ProtocolError,
  type DeltaMessage,
  type ViewTransport,
  type SnapshotMessage,
} from '@hexfront/protocol';
import type { GameEvent, PlanView, PlayerView, UnitView } from '@hexfront/sim';

export { buildViewDelta, canBuildViewDelta, ConfirmedViewDeltaStream };
// Поток дельт живёт в протоколе: им же пользуется сервер комнаты.
export type { ViewTransport };

export type FullSnapshotReason = 'start' | 'view' | 'fog';
type ViewEvent = GameEvent;

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
