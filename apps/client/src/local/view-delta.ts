import {
  ProtocolError,
  type DeltaMessage,
  type HexChange,
  type SnapshotMessage,
} from '@hexfront/protocol';
import type { GameEvent, PlanView, PlayerView, UnitView } from '@hexfront/sim';

export type FullSnapshotReason = 'start' | 'view' | 'fog';
type ViewEvent = GameEvent;

function replaceCollection<T extends { readonly id: number }>(
  current: readonly T[],
  upsert: readonly T[],
  removed: readonly number[],
): readonly T[] {
  const removedIds = new Set(removed);
  const result = current.filter((item) => !removedIds.has(item.id));
  const positions = new Map(result.map((item, index) => [item.id, index]));
  for (const item of upsert) {
    const index = positions.get(item.id);
    if (index === undefined) {
      positions.set(item.id, result.length);
      result.push(item);
    } else {
      result[index] = item;
    }
  }
  return result.sort((left, right) => left.id - right.id);
}

function replacePlans(
  current: readonly PlanView[],
  upsert: readonly PlanView[],
  removed: readonly number[],
): readonly PlanView[] {
  const removedIds = new Set(removed);
  const result = current.filter((plan) => !removedIds.has(plan.armyId));
  const positions = new Map(result.map((plan, index) => [plan.armyId, index]));
  for (const plan of upsert) {
    const index = positions.get(plan.armyId);
    if (index === undefined) {
      positions.set(plan.armyId, result.length);
      result.push(plan);
    } else {
      result[index] = plan;
    }
  }
  return result.sort((left, right) => left.armyId - right.armyId);
}

function applyHexChanges(view: PlayerView, changes: readonly HexChange[]): PlayerView['hexes'] {
  const hexes = {
    owner: view.hexes.owner.slice(),
    pop: view.hexes.pop.slice(),
    improvement: view.hexes.improvement.slice(),
    building: view.hexes.building.slice(),
    road: view.hexes.road.slice(),
    link: view.hexes.link.slice(),
    growth: view.hexes.growth.slice(),
    visible: view.hexes.visible.slice(),
  };
  for (const change of changes) {
    if (change.owner !== undefined) hexes.owner[change.id] = change.owner;
    if (change.pop !== undefined) hexes.pop[change.id] = change.pop;
    if (change.improvement !== undefined) hexes.improvement[change.id] = change.improvement;
    if (change.building !== undefined) hexes.building[change.id] = change.building;
    if (change.road !== undefined) hexes.road[change.id] = change.road;
    if (change.link !== undefined) hexes.link[change.id] = change.link;
    if (change.growth !== undefined) hexes.growth[change.id] = change.growth;
    if (change.visible !== undefined) hexes.visible[change.id] = change.visible;
  }
  return hexes;
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
    this.currentView = {
      ...view,
      tick: message.tick,
      hexes: applyHexChanges(view, message.d.hexes),
      units: replaceCollection(view.units, message.d.units.upsert, message.d.units.removed),
      plans: replacePlans(view.plans, message.d.fronts.upsert, message.d.fronts.removed),
    };
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
