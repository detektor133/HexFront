import type { MatchState } from './types.ts';

interface DerivedCache {
  readonly dirtyNetworks: Set<number>;
  readonly initializedNetworks: Set<number>;
  readonly supplyRevisions: Map<number, number>;
}

const caches = new WeakMap<MatchState, DerivedCache>();

function cacheOf(state: MatchState): DerivedCache {
  const cached = caches.get(state);
  if (cached) return cached;
  const created: DerivedCache = {
    dirtyNetworks: new Set(),
    initializedNetworks: new Set(),
    supplyRevisions: new Map(),
  };
  caches.set(state, created);
  return created;
}

export function markNetworkDirty(state: MatchState, playerId: number): void {
  if (playerId < 0) return;
  cacheOf(state).dirtyNetworks.add(playerId);
  markSupplyDirty(state, playerId);
}

export function markSupplyDirty(state: MatchState, playerId: number): void {
  if (playerId < 0) return;
  const cache = cacheOf(state);
  cache.supplyRevisions.set(playerId, (cache.supplyRevisions.get(playerId) ?? 0) + 1);
}

export function networkNeedsRecompute(state: MatchState, playerId: number): boolean {
  const cache = cacheOf(state);
  return !cache.initializedNetworks.has(playerId) || cache.dirtyNetworks.has(playerId);
}

export function markNetworkClean(state: MatchState, playerId: number): void {
  const cache = cacheOf(state);
  cache.dirtyNetworks.delete(playerId);
  cache.initializedNetworks.add(playerId);
}

export function supplyRevision(state: MatchState, playerId: number): number {
  return cacheOf(state).supplyRevisions.get(playerId) ?? 0;
}
