// Глубокая копия состояния для проверки повторяемости: неизменяемая карта общая,
// всё изменяемое (гексы, сущности, пути) копируется.
import type { MatchState } from '../../src/state/types.ts';

/** Независимая копия состояния матча. */
export function cloneState(s: MatchState): MatchState {
  const h = s.hexes;
  return {
    ...s,
    hexes: {
      owner: h.owner.slice(),
      pop: h.pop.slice(),
      improvement: h.improvement.slice(),
      building: h.building.slice(),
      road: h.road.slice(),
      network: h.network.slice(),
    },
    cities: s.cities.map((c) => ({ ...c })),
    players: s.players.map((p) => ({ ...p })),
    units: s.units.map((u) => ({ ...u, path: [...u.path] })),
    armies: s.armies.map((a) => ({ ...a })),
    constructions: s.constructions.map((c) => ({ ...c })),
    recruits: s.recruits.map((r) => ({ ...r })),
    networks: s.networks.map((n) => ({ ...n })),
    events: [...s.events],
  };
}
