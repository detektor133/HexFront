import type { GameEvent, PlayerView } from '@hexfront/sim';

export interface EventFeedItem {
  readonly id: string;
  readonly event: GameEvent;
  readonly hex: number | null;
  readonly important: boolean;
  readonly expiresAt: number;
}

export const EVENT_TTL_MS = 6000;

export function eventHex(event: GameEvent, view: PlayerView): number | null {
  if (event.t === 'unitDestroyed' || event.t === 'unitRetreated' || event.t === 'unitCapitulated') {
    return event.hex;
  }
  if (event.t === 'cityCaptured' || event.t === 'capitalMoved') {
    return view.cities.find((city) => city.id === event.cityId)?.hex ?? null;
  }
  if (event.t === 'offensiveDone') {
    const army = view.armies.find((candidate) => candidate.id === event.armyId);
    return view.units.find((unit) => unit.armyId === army?.id)?.hex ?? null;
  }
  return null;
}

export function isImportantEvent(event: GameEvent): boolean {
  return event.t === 'unitCapitulated' || event.t === 'cityCaptured' || event.t === 'capitalMoved';
}

export function appendEvents(
  items: readonly EventFeedItem[],
  events: readonly GameEvent[],
  view: PlayerView,
  now: number,
): EventFeedItem[] {
  const fresh = events.map((event, index) => ({
    id: `${view.tick}:${index}`,
    event,
    hex: eventHex(event, view),
    important: isImportantEvent(event),
    expiresAt: now + EVENT_TTL_MS,
  }));
  return [...items, ...fresh].filter((item) => item.expiresAt > now).slice(-3);
}

export function visibleEvents(items: readonly EventFeedItem[], now: number): EventFeedItem[] {
  return items.filter((item) => item.expiresAt > now);
}
