// Стройки: прогресс, завершение, отмена при потере гекса.
// GDD: docs/gdd/03-cities-buildings.md
import { MILITIA_PER_LEVEL, ORG_MAX } from '../balance.ts';
import { advanceRoad, queueAutoRoad, roadLost } from './road-construction.ts';
import { BUILDING, type Construction, type MatchState } from '../state/types.ts';

function complete(state: MatchState, c: Construction): void {
  const { hexes } = state;
  switch (c.kind) {
    case 'foundCity':
      // Id растут монотонно, поэтому push сохраняет сортировку городов по id.
      state.cities.push({
        id: state.nextId,
        hex: c.hex,
        owner: c.owner,
        level: 1,
        name: '',
        // Новый город получает полное ополчение (03-cities-buildings.md, «Захват города»).
        defenders: MILITIA_PER_LEVEL,
        defenseOrg: ORG_MAX,
        inBattle: false,
      });
      state.nextId += 1;
      queueAutoRoad(state, c.owner, c.hex);
      return;
    case 'upgradeCity': {
      const city = state.cities.find((x) => x.hex === c.hex);
      if (city) city.level += 1;
      return;
    }
    case 'improve':
      hexes.improvement[c.hex] = (hexes.improvement[c.hex] ?? 0) + 1;
      return;
    case 'fort':
      hexes.building[c.hex] = BUILDING.fort;
      return;
    case 'depot':
      hexes.building[c.hex] = BUILDING.depot;
      return;
    case 'road':
      return;
  }
}

/** Двигает стройки на тик; захваченный гекс отменяет стройку, золото не возвращается. */
export function constructionSystem(state: MatchState): void {
  const remaining: Construction[] = [];
  for (const c of state.constructions) {
    const event = { playerId: c.owner, kind: c.kind, hex: c.hex };
    const lost = c.kind === 'road' ? roadLost(state, c) : state.hexes.owner[c.hex] !== c.owner;
    if (lost) {
      state.events.push({ t: 'constructionCancelled', ...event });
      continue;
    }
    if (c.kind === 'road') advanceRoad(state, c);
    else c.progressTicks += 1;
    if (c.progressTicks < c.totalTicks) {
      remaining.push(c);
      continue;
    }
    complete(state, c);
    state.events.push({ t: 'constructionDone', ...event });
  }
  state.constructions.splice(0, state.constructions.length, ...remaining);
}
