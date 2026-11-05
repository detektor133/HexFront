// Список построек игрока для окна «Постройки»: города, склады, укрепления и текущие стройки с
// ценой следующего улучшения. Только чтение вида: улучшает команда sim, окно лишь отправляет её.
import {
  CITY_UPGRADE_COST,
  DEPOT_UPGRADE_COST,
  FORT_UPGRADE_COST,
  depotLevel,
  fortLevel,
  type ConstructionKind,
  type PlayerView,
} from '@hexfront/sim';

export interface CityRow {
  readonly id: number;
  readonly hex: number;
  readonly name: string;
  readonly level: number;
  readonly isCapital: boolean;
  readonly isolated: boolean;
  /** Людей на гексе города, fixed-point. */
  readonly pop: number;
  /** Цена улучшения до следующего уровня, fixed-point золота; null — уровень максимальный. */
  readonly upgradeCost: number | null;
  readonly busy: boolean;
}

export interface SiteRow {
  readonly hex: number;
  readonly level: number;
  readonly upgradeCost: number | null;
  readonly busy: boolean;
}

export interface BuildRow {
  readonly hex: number;
  readonly kind: ConstructionKind;
  /** Доля готовности 0..1. */
  readonly progress: number;
}

export interface BuildingsList {
  readonly gold: number;
  readonly incomePerS: number;
  readonly cities: readonly CityRow[];
  readonly depots: readonly SiteRow[];
  readonly forts: readonly SiteRow[];
  readonly constructions: readonly BuildRow[];
}

/** Постройки игрока по его виду; порядок: столица, затем по уровню, склады и форты — по гексу. */
export function buildingsList(view: PlayerView): BuildingsList {
  const me = view.playerId;
  const busy = new Set(view.constructions.filter((c) => c.owner === me).map((c) => c.hex));
  const cities = view.cities
    .filter((c) => c.owner === me)
    .map((c): CityRow => ({
      id: c.id,
      hex: c.hex,
      name: c.name,
      level: c.level,
      isCapital: c.isCapital,
      isolated: c.isolated,
      pop: view.hexes.pop[c.hex] ?? 0,
      upgradeCost: CITY_UPGRADE_COST[c.level - 1] ?? null,
      busy: busy.has(c.hex),
    }))
    .sort((a, b) => Number(b.isCapital) - Number(a.isCapital) || b.level - a.level || a.id - b.id);
  const depots: SiteRow[] = [];
  const forts: SiteRow[] = [];
  view.hexes.owner.forEach((owner, hex) => {
    if (owner !== me) return;
    const code = view.hexes.building[hex] ?? 0;
    const depot = depotLevel(code);
    if (depot > 0) {
      depots.push({
        hex,
        level: depot,
        upgradeCost: DEPOT_UPGRADE_COST[depot - 1] ?? null,
        busy: busy.has(hex),
      });
    }
    const fort = fortLevel(code);
    if (fort > 0) {
      forts.push({
        hex,
        level: fort,
        upgradeCost: FORT_UPGRADE_COST[fort - 1] ?? null,
        busy: busy.has(hex),
      });
    }
  });
  return {
    gold: view.players[me]?.gold ?? 0,
    incomePerS: view.me.incomePerS,
    cities,
    depots,
    forts,
    constructions: view.constructions
      .filter((c) => c.owner === me && c.kind !== 'road')
      .map((c) => ({
        hex: c.hex,
        kind: c.kind,
        progress: c.totalTicks > 0 ? Math.min(1, c.progressTicks / c.totalTicks) : 0,
      })),
  };
}
