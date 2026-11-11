// Стройки: прогресс, завершение, отмена при потере гекса.
// GDD: docs/gdd/03-cities-buildings.md
import { MILITIA_PER_LEVEL, ORG_MAX } from '../balance.ts';
import { advanceRoad, queueAutoRoad, roadLost } from './road-construction.ts';
import { pickCityName } from '../map/city-names.ts';
import { withDepot, withFort } from '../state/building.ts';
import { depotLevel } from '../state/depot.ts';
import { markNetworkDirty, markSupplyDirty } from '../state/derived-cache.ts';
import { fortLevel } from '../state/fort.ts';
import { addCity, setBuilding, setCityLevel, setImprovement } from '../state/layers.ts';
import { type Construction, type MatchState } from '../state/types.ts';
import { addCityToIndex } from '../state/unit-index.ts';

function complete(state: MatchState, c: Construction): void {
  const { hexes } = state;
  switch (c.kind) {
    case 'foundCity': {
      // Id растут монотонно, поэтому push сохраняет сортировку городов по id.
      const city = {
        id: state.nextId,
        hex: c.hex,
        owner: c.owner,
        level: 1,
        name: pickCityName(state.seed, state.nextId, state.cities),
        // Новый город получает полное ополчение (03-cities-buildings.md, «Захват города»).
        defenders: MILITIA_PER_LEVEL,
        defenseOrg: ORG_MAX,
        inBattle: false,
        captureTicks: 0,
      };
      addCity(state, city);
      addCityToIndex(state, city);
      markNetworkDirty(state, c.owner);
      state.nextId += 1;
      queueAutoRoad(state, c.owner, c.hex);
      return;
    }
    case 'upgradeCity': {
      const city = state.cities.find((x) => x.hex === c.hex);
      if (city) setCityLevel(state, city, city.level + 1);
      return;
    }
    case 'improve':
      setImprovement(state, c.hex, (hexes.improvement[c.hex] ?? 0) + 1);
      return;
    case 'fort':
      setBuilding(state, c.hex, withFort(hexes.building[c.hex] ?? 0, 1));
      state.supplyRevision += 1;
      markSupplyDirty(state, c.owner);
      return;
    case 'upgradeFort':
      setBuilding(
        state,
        c.hex,
        withFort(hexes.building[c.hex] ?? 0, fortLevel(hexes.building[c.hex] ?? 0) + 1),
      );
      return;
    case 'depot':
      setBuilding(state, c.hex, withDepot(hexes.building[c.hex] ?? 0, 1));
      state.supplyRevision += 1;
      markSupplyDirty(state, c.owner);
      markNetworkDirty(state, c.owner);
      // Склад сам просит дорогу к основной сети, как город: иначе он изолирован.
      queueAutoRoad(state, c.owner, c.hex, true);
      return;
    case 'upgradeDepot':
      setBuilding(
        state,
        c.hex,
        withDepot(hexes.building[c.hex] ?? 0, depotLevel(hexes.building[c.hex] ?? 0) + 1),
      );
      state.supplyRevision += 1;
      markSupplyDirty(state, c.owner);
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
