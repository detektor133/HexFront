import type { GameEvent, PlayerView } from '@hexfront/sim';

export interface EventFeedItem {
  readonly id: string;
  readonly event: GameEvent;
  readonly hex: number | null;
  readonly important: boolean;
  readonly expiresAt: number;
}

export const EVENT_TTL_MS = 20000;
/** Мест в ленте: больше записей — лишние уходят в счётчик «+K». */
export const FEED_SLOTS = 5;
/** Сколько последних событий помнит лента: с запасом на счётчик «+K». */
const EVENTS_KEPT = 16;

export function eventHex(event: GameEvent, view: PlayerView): number | null {
  if (event.t === 'unitDestroyed' || event.t === 'unitRetreated' || event.t === 'unitCapitulated') {
    return event.hex;
  }
  if (event.t === 'playerEliminated') {
    return null;
  }
  if (event.t === 'cityCaptured' || event.t === 'capitalMoved') {
    return view.cities.find((city) => city.id === event.cityId)?.hex ?? null;
  }
  if (
    event.t === 'warDeclared' ||
    event.t === 'treatyMade' ||
    event.t === 'treatyBroken' ||
    event.t === 'treatyOffered'
  ) {
    // Щелчок ведёт к столице другой стороны: там открывается карточка с дипломатией.
    const other = event.playerId === view.playerId ? event.targetId : event.playerId;
    return view.cities.find((city) => city.owner === other && city.isCapital)?.hex ?? null;
  }
  if (event.t === 'offensiveDone') {
    const army = view.armies.find((candidate) => candidate.id === event.armyId);
    return view.units.find((unit) => unit.armyId === army?.id)?.hex ?? null;
  }
  return null;
}

export function isImportantEvent(event: GameEvent): boolean {
  return (
    event.t === 'unitDestroyed' ||
    event.t === 'unitCapitulated' ||
    event.t === 'cityCaptured' ||
    event.t === 'playerEliminated' ||
    event.t === 'warDeclared'
  );
}

function isVisibleEvent(event: GameEvent, localPlayerId: number): boolean {
  if (event.t === 'unitDestroyed' || event.t === 'unitCapitulated') {
    return event.playerId === localPlayerId;
  }
  if (
    event.t === 'warDeclared' ||
    event.t === 'treatyMade' ||
    event.t === 'treatyBroken' ||
    event.t === 'treatyOffered'
  ) {
    // Предложение интересно только адресату; остальное — обеим сторонам.
    return event.t === 'treatyOffered'
      ? event.targetId === localPlayerId
      : event.playerId === localPlayerId || event.targetId === localPlayerId;
  }
  return (
    event.t === 'cityCaptured' &&
    (event.previousOwnerId === localPlayerId || event.newOwnerId === localPlayerId)
  );
}

// Капитуляция врага (с кем война) видна в ленте; мир и пакты — не наше дело.
function isEnemyFall(event: GameEvent, view: PlayerView, localPlayerId: number): boolean {
  if (event.t !== 'playerEliminated' || event.playerId === localPlayerId) return false;
  return view.diplomacy ? view.diplomacy.relations[event.playerId] === 'war' : true;
}

export function appendEvents(
  items: readonly EventFeedItem[],
  events: readonly GameEvent[],
  view: PlayerView,
  now: number,
  localPlayerId: number = view.playerId ?? 0,
): EventFeedItem[] {
  const fresh = events
    .filter(
      (event) => isVisibleEvent(event, localPlayerId) || isEnemyFall(event, view, localPlayerId),
    )
    .map((event, index) => ({
      id: `${view.tick}:${index}`,
      event,
      hex: eventHex(event, view),
      important: isImportantEvent(event),
      expiresAt: now + EVENT_TTL_MS,
    }));
  return [...items, ...fresh].filter((item) => item.expiresAt > now).slice(-EVENTS_KEPT);
}

export function visibleEvents(items: readonly EventFeedItem[], now: number): EventFeedItem[] {
  return items.filter((item) => item.expiresAt > now);
}
