import type { GameEvent, PlanView, PlayerView, UnitView } from '@hexfront/sim';

export interface SnapshotMessage {
  readonly t: 'snapshot';
  readonly tick: number;
  readonly view: PlayerView;
}

export interface HexChange {
  readonly id: number;
  readonly owner?: number;
  readonly pop?: number;
  readonly improvement?: number;
  readonly building?: number;
  readonly road?: number;
  readonly link?: number;
  readonly growth?: number;
  readonly visible?: number;
}

export interface CollectionDelta<T> {
  readonly upsert: readonly T[];
  readonly removed: readonly number[];
}

export interface ViewDelta {
  readonly hexes: readonly HexChange[];
  readonly units: CollectionDelta<UnitView>;
  readonly fronts: CollectionDelta<PlanView>;
  readonly events: readonly GameEvent[];
}

export interface DeltaMessage {
  readonly t: 'delta';
  readonly baseTick: number;
  readonly tick: number;
  readonly d: ViewDelta;
}

export class ProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

type WireView = Omit<PlayerView, 'hexes'> & {
  readonly hexes: {
    readonly owner: number[];
    readonly pop: number[];
    readonly improvement: number[];
    readonly building: number[];
    readonly road: number[];
    readonly link: number[];
    readonly growth: number[];
    readonly visible: number[];
  };
};

function wireView(view: PlayerView): WireView {
  return {
    ...view,
    hexes: {
      owner: Array.from(view.hexes.owner),
      pop: Array.from(view.hexes.pop),
      improvement: Array.from(view.hexes.improvement),
      building: Array.from(view.hexes.building),
      road: Array.from(view.hexes.road),
      link: Array.from(view.hexes.link),
      growth: Array.from(view.hexes.growth),
      visible: Array.from(view.hexes.visible),
    },
  };
}

function playerView(wire: WireView): PlayerView {
  return {
    ...wire,
    hexes: {
      owner: Int16Array.from(wire.hexes.owner),
      pop: Int32Array.from(wire.hexes.pop),
      improvement: Uint8Array.from(wire.hexes.improvement),
      building: Uint8Array.from(wire.hexes.building),
      road: Uint8Array.from(wire.hexes.road),
      link: Uint8Array.from(wire.hexes.link),
      growth: Int32Array.from(wire.hexes.growth),
      visible: Uint8Array.from(wire.hexes.visible),
    },
  };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProtocolError('Некорректный JSON протокола');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('Некорректное сообщение протокола');
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ProtocolError(`Некорректное поле ${name}`);
  }
  return value;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new ProtocolError(`Некорректное поле ${name}`);
  return value;
}

function decodeWireView(value: unknown): WireView {
  const source = record(value);
  const hexes = record(source.hexes);
  const names = [
    'owner',
    'pop',
    'improvement',
    'building',
    'road',
    'link',
    'growth',
    'visible',
  ] as const;
  const arrays = Object.fromEntries(
    names.map((name) => [
      name,
      array(hexes[name], `hexes.${name}`).map((item) => integer(item, `hexes.${name}`)),
    ]),
  ) as WireView['hexes'];
  return { ...source, hexes: arrays } as WireView;
}

export function encodeSnapshot(message: SnapshotMessage): string {
  return JSON.stringify({ ...message, view: wireView(message.view) });
}

export function decodeSnapshot(text: string): SnapshotMessage {
  const source = record(parse(text));
  if (source.t !== 'snapshot') throw new ProtocolError('Ожидался полный снимок');
  const tick = integer(source.tick, 'tick');
  const view = playerView(decodeWireView(source.view));
  if (view.tick !== tick) throw new ProtocolError('Тик снимка не совпадает с видом');
  return { t: 'snapshot', tick, view };
}

export function encodeDelta(message: DeltaMessage): string {
  return JSON.stringify(message);
}

export function decodeDelta(text: string, expectedBaseTick?: number): DeltaMessage {
  const source = record(parse(text));
  if (source.t !== 'delta') throw new ProtocolError('Ожидалась дельта');
  const baseTick = integer(source.baseTick, 'baseTick');
  const tick = integer(source.tick, 'tick');
  if (tick <= baseTick) throw new ProtocolError('Тик дельты должен быть новее базы');
  if (expectedBaseTick !== undefined && baseTick !== expectedBaseTick) {
    throw new ProtocolError('Неверная база дельты');
  }
  const delta = record(source.d);
  array(delta.hexes, 'd.hexes');
  record(delta.units);
  record(delta.fronts);
  array(delta.events, 'd.events');
  return source as unknown as DeltaMessage;
}
