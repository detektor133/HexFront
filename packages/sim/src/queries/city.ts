// Запросы для интерфейса: карточка города, «можно ли основать город», предпросмотр перестройки.
// Чистые функции, состояние не меняют. GDD: docs/gdd/07-controls.md — «Карточка города»;
// docs/art/ui.md — «Карточка города — статус снабжения».
import { checkConstruction, type ConstructionCheck } from '../commands/construction.ts';
import { rebuildSupplyPlan, type RebuildPlan } from '../commands/rebuild-supply.ts';
import type { HexId } from '../math/hex.ts';
import { intDiv, type Fp } from '../math/int.ts';
import { cityGold } from '../state/city-output.ts';
import { isCityIsolated } from '../state/network.ts';
import { cityPopCap } from '../state/pop-cap.ts';
import { citySupply } from '../state/supply.ts';
import type { ConstructionKind, MatchState } from '../state/types.ts';
import { hexGrowthPerSecond } from '../systems/population.ts';
import { ROAD_TICKS_PER_HEX } from '../systems/road-construction.ts';

/** Всё, что показывает карточка города. Числа — fixed-point, тексты собирает интерфейс (i18n). */
export interface CityInfo {
  readonly id: number;
  readonly hex: HexId;
  readonly name: string;
  readonly level: number;
  readonly owner: number;
  readonly isCapital: boolean;
  /** Население и лимит городского гекса, людей. */
  readonly pop: number;
  readonly popCap: Fp;
  /** Людей в секунду; отрицательное — убыль сверх лимита. */
  readonly growthPerS: number;
  /** Снабжение, которое производит город, с учётом изоляции. */
  readonly supply: Fp;
  /** Золото в секунду от самого города, с учётом изоляции. */
  readonly goldPerS: Fp;
  readonly link: 'connected' | 'isolated';
  /** Прокладка дороги этого города (авто-дорога или перестройка): «N из M» гексов. */
  readonly roadJob: { readonly built: number; readonly total: number } | null;
  /** Стройка на гексе города (улучшение), если идёт. */
  readonly construction: {
    readonly kind: ConstructionKind;
    readonly progressTicks: number;
    readonly totalTicks: number;
  } | null;
  /** Кнопка «Улучшить»: цена и время следующего уровня или причина. */
  readonly upgrade: ConstructionCheck;
  /** Кнопка «Перестроить снабжение» — только у изолированного города. */
  readonly rebuild: RebuildPlan | null;
}

/**
 * Можно ли основать город на гексе; та же проверка, что у команды foundCity.
 * @returns цена и время (fixed-point) или причина отказа
 */
export function canFoundCity(state: MatchState, playerId: number, hex: HexId): ConstructionCheck {
  return checkConstruction(state, playerId, { t: 'foundCity', hex });
}

/**
 * Предпросмотр перестройки снабжения: путь для подсветки, гексы без дороги, цена.
 * @returns план (с флагом affordable) или причина, почему кнопка недоступна
 */
export function rebuildSupplyPreview(
  state: MatchState,
  playerId: number,
  cityId: number,
): RebuildPlan {
  return rebuildSupplyPlan(state, playerId, cityId);
}

/**
 * Данные карточки города.
 * @returns поля карточки или null, если города нет
 */
export function cityInfo(state: MatchState, cityId: number): CityInfo | null {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return null;
  const isCapital = state.players[city.owner]?.capitalCityId === city.id;
  const isolated = isCityIsolated(state, city.id);
  const road = state.constructions.find((c) => c.kind === 'road' && c.hex === city.hex);
  const build = state.constructions.find((c) => c.kind !== 'road' && c.hex === city.hex);
  return {
    id: city.id,
    hex: city.hex,
    name: city.name,
    level: city.level,
    owner: city.owner,
    isCapital,
    pop: state.hexes.pop[city.hex] ?? 0,
    popCap: cityPopCap(city.level),
    growthPerS: hexGrowthPerSecond(state, city.hex),
    supply: citySupply(state, city),
    goldPerS: cityGold(state, city),
    link: isolated ? 'isolated' : 'connected',
    roadJob: road
      ? { built: intDiv(road.progressTicks, ROAD_TICKS_PER_HEX), total: road.path?.length ?? 0 }
      : null,
    construction: build
      ? { kind: build.kind, progressTicks: build.progressTicks, totalTicks: build.totalTicks }
      : null,
    upgrade: checkConstruction(state, city.owner, { t: 'upgradeCity', cityId: city.id }),
    rebuild: isolated ? rebuildSupplyPlan(state, city.owner, city.id) : null,
  };
}
