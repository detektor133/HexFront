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
  'armies',
  'me',
  'constructions',
  'recruits',
  'diplomacy',
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

/**
 * Сравнивает восемь массивов гексов; запись создаётся только для изменённого гекса.
 * Горячий цикл (каждый тик, каждому игроку): без объектов и `Object.keys` на каждый гекс.
 */
function collectHexChanges(a: PlayerView['hexes'], b: PlayerView['hexes'], out: HexChange[]): void {
  const count = b.owner.length;
  for (let id = 0; id < count; id += 1) {
    if (
      a.owner[id] === b.owner[id] &&
      a.pop[id] === b.pop[id] &&
      a.improvement[id] === b.improvement[id] &&
      a.building[id] === b.building[id] &&
      a.road[id] === b.road[id] &&
      a.link[id] === b.link[id] &&
      a.growth[id] === b.growth[id] &&
      a.visible[id] === b.visible[id]
    ) {
      continue;
    }
    const change: { -readonly [K in keyof HexChange]: HexChange[K] } = { id };
    if (a.owner[id] !== b.owner[id]) change.owner = b.owner[id] as number;
    if (a.pop[id] !== b.pop[id]) change.pop = b.pop[id] as number;
    if (a.improvement[id] !== b.improvement[id]) change.improvement = b.improvement[id] as number;
    if (a.building[id] !== b.building[id]) change.building = b.building[id] as number;
    if (a.road[id] !== b.road[id]) change.road = b.road[id] as number;
    if (a.link[id] !== b.link[id]) change.link = b.link[id] as number;
    if (a.growth[id] !== b.growth[id]) change.growth = b.growth[id] as number;
    if (a.visible[id] !== b.visible[id]) change.visible = b.visible[id] as number;
    out.push(change);
  }
}

export function buildViewDelta(
  before: PlayerView,
  after: PlayerView,
  events: readonly GameEvent[],
): DeltaMessage {
  const hexes: HexChange[] = [];
  const view: Partial<ViewMetadata> = {};
  collectHexChanges(before.hexes, after.hexes, hexes);
  for (const field of METADATA_FIELDS) {
    if (!equalValue(before[field], after[field])) Object.assign(view, { [field]: after[field] });
  }
  const cities = collectionDelta(before.cities, after.cities);
  const players = collectionDelta(before.players, after.players);
  return {
    t: 'delta',
    baseTick: before.tick,
    tick: after.tick,
    d: {
      hexes,
      units: collectionDelta(before.units, after.units),
      fronts: planDelta(before.plans, after.plans),
      ...(cities.upsert.length > 0 || cities.removed.length > 0 ? { cities } : {}),
      ...(players.upsert.length > 0 || players.removed.length > 0 ? { players } : {}),
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
  // Копируем лишь массивы, в которых есть изменения: остальные делятся с прошлым видом,
  // иначе каждый тик (10 Гц) аллоцирует по 8 больших массивов и душит GC.
  const touched = new Set<keyof PlayerView['hexes']>();
  for (const change of changes) {
    for (const key of Object.keys(change))
      if (key !== 'id') touched.add(key as keyof PlayerView['hexes']);
  }
  const own = <K extends keyof PlayerView['hexes']>(key: K): PlayerView['hexes'][K] =>
    touched.has(key) ? (view.hexes[key].slice() as PlayerView['hexes'][K]) : view.hexes[key];
  const hexes = {
    owner: own('owner'),
    pop: own('pop'),
    improvement: own('improvement'),
    building: own('building'),
    road: own('road'),
    link: own('link'),
    growth: own('growth'),
    visible: own('visible'),
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
      cities: message.d.cities
        ? replaceCollection(view.cities, message.d.cities.upsert, message.d.cities.removed)
        : view.cities,
      players: message.d.players
        ? replaceCollection(view.players, message.d.players.upsert, message.d.players.removed)
        : view.players,
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
