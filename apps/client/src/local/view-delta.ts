import {
  ProtocolError,
  type DeltaMessage,
  type HexChange,
  type SnapshotMessage,
  type ViewMetadata,
} from '@hexfront/protocol';
import type { GameEvent, PlanView, PlayerView, UnitView } from '@hexfront/sim';

export type FullSnapshotReason = 'start' | 'view' | 'fog';
type ViewEvent = GameEvent;

function equalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right)) return false;
    const leftValues = left as unknown as ArrayLike<unknown>;
    const rightValues = right as unknown as ArrayLike<unknown>;
    if (leftValues.length !== rightValues.length) return false;
    for (let index = 0; index < leftValues.length; index += 1) {
      if (!equalValue(leftValues[index], rightValues[index])) return false;
    }
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => equalValue(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => key in rightRecord && equalValue(leftRecord[key], rightRecord[key]))
  );
}

const METADATA_FIELDS: readonly (keyof ViewMetadata)[] = [
  'winner',
  'playerId',
  'victoryHold',
  'ranking',
  'cities',
  'armies',
  'players',
  'me',
  'constructions',
  'recruits',
];

function sameHexShape(left: PlayerView, right: PlayerView): boolean {
  const names: readonly (keyof PlayerView['hexes'])[] = [
    'owner',
    'pop',
    'improvement',
    'building',
    'road',
    'link',
    'growth',
    'visible',
  ];
  return names.every((name) => left.hexes[name].length === right.hexes[name].length);
}

function collectionDelta<T extends { readonly id: number }>(
  before: readonly T[],
  after: readonly T[],
): { readonly upsert: readonly T[]; readonly removed: readonly number[] } {
  const oldById = new Map(before.map((item) => [item.id, item]));
  const currentIds = new Set(after.map((item) => item.id));
  const upsert = after.filter((item) => !equalValue(oldById.get(item.id), item));
  const removed = before.filter((item) => !currentIds.has(item.id)).map((item) => item.id);
  return { upsert, removed };
}

function planDelta(
  before: readonly PlanView[],
  after: readonly PlanView[],
): { readonly upsert: readonly PlanView[]; readonly removed: readonly number[] } {
  const oldById = new Map(before.map((plan) => [plan.armyId, plan]));
  const currentIds = new Set(after.map((plan) => plan.armyId));
  const upsert = after.filter((plan) => !equalValue(oldById.get(plan.armyId), plan));
  const removed = before.filter((plan) => !currentIds.has(plan.armyId)).map((plan) => plan.armyId);
  return { upsert, removed };
}

export function canBuildViewDelta(before: PlayerView, after: PlayerView): boolean {
  return sameHexShape(before, after) && before.playerId === after.playerId;
}

export function buildViewDelta(
  before: PlayerView,
  after: PlayerView,
  events: readonly GameEvent[],
): DeltaMessage {
  const hexes: HexChange[] = [];
  const view: Partial<ViewMetadata> = {};
  const names: readonly (keyof PlayerView['hexes'])[] = [
    'owner',
    'pop',
    'improvement',
    'building',
    'road',
    'link',
    'growth',
    'visible',
  ];
  for (let id = 0; id < after.hexes.owner.length; id += 1) {
    const change: HexChange = { id };
    for (const name of names) {
      const value = after.hexes[name][id];
      if (value !== before.hexes[name][id]) Object.assign(change, { [name]: value });
    }
    if (Object.keys(change).length > 1) hexes.push(change);
  }
  for (const field of METADATA_FIELDS) {
    if (!equalValue(before[field], after[field])) Object.assign(view, { [field]: after[field] });
  }
  return {
    t: 'delta',
    baseTick: before.tick,
    tick: after.tick,
    d: {
      hexes,
      units: collectionDelta(before.units, after.units),
      fronts: planDelta(before.plans, after.plans),
      ...(Object.keys(view).length > 0 ? { view } : {}),
      events,
    },
  };
}

export type ViewTransport =
  | { readonly kind: 'snapshot'; readonly snapshot: SnapshotMessage }
  | { readonly kind: 'delta'; readonly delta: DeltaMessage };

export class ConfirmedViewDeltaStream {
  private confirmed: PlayerView | null = null;
  private sent: PlayerView | null = null;
  private waiting = false;
  private forceFull = true;

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
    const transport: ViewTransport =
      this.forceFull || this.confirmed === null || !canBuildViewDelta(this.confirmed, view)
        ? { kind: 'snapshot', snapshot: { t: 'snapshot', tick: view.tick, view } }
        : { kind: 'delta', delta: buildViewDelta(this.confirmed, view, events) };
    this.forceFull = false;
    this.sent = view;
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
      ...(message.d.view ?? {}),
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
