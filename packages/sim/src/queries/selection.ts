// Что можно сделать с выбранным гексом: цены и причины отказа для кнопок карточки города/гекса.
// Считает локальный воркер и сервер (по запросу игрока): состояние нужно целиком, у клиента сети его нет.
import { COST_POP_PER_SOLDIER, RECRUIT_MIN, RECRUIT_STEP, type UnitType } from '../balance.ts';
import { canFoundCity, cityInfo, type CityInfo } from './city.ts';
import { checkConstruction, type ConstructionCheck } from '../commands/construction.ts';
import { rebuildSupplyPlan, type RebuildPlan } from '../commands/rebuild-supply.ts';
import { checkRecruit, recruitCapacity, type RecruitCheck } from '../commands/recruit.ts';
import { fpDiv, intDiv, type Fp } from '../math/int.ts';
import { isDepot } from '../state/depot.ts';
import { cityPopCap, hexPopCap } from '../state/pop-cap.ts';
import type { MatchState } from '../state/types.ts';

/** Один размер набора в своём городе: число солдат, цена, время и причина отказа. */
export interface RecruitAmount {
  readonly soldiers: Fp;
  readonly check: RecruitCheck;
}

/** Варианты набора в своём городе для карточки города. */
export interface RecruitOption {
  readonly type: UnitType;
  readonly amounts: RecruitAmount[];
}

/** Что можно сделать с выбранным гексом: цены и причины отказа для кнопок. */
export interface Selection {
  readonly hex: number;
  /** Лимит населения гекса, fixed-point людей. */
  readonly popCap: number;
  readonly city: CityInfo | null;
  readonly foundCity: ConstructionCheck;
  readonly improve: ConstructionCheck;
  readonly fort: ConstructionCheck;
  readonly depot: ConstructionCheck;
  /** Код постройки на гексе (`BUILDING`): склад любого уровня — улучшение вместо постройки. */
  readonly building: number;
  /** План дороги для изолированного склада; для города используется `city.rebuild`. */
  readonly rebuild: RebuildPlan | null;
  /** Набор — только в своём городе; иначе пусто. */
  readonly recruit: readonly RecruitOption[];
}

const RECRUIT_TYPES: readonly UnitType[] = ['infantry', 'armor', 'artillery'];

function recruitOptions(state: MatchState, playerId: number, cityId: number): RecruitOption[] {
  return RECRUIT_TYPES.map((type) => {
    const capacity = recruitCapacity(state, cityId);
    const rawMax = fpDiv(capacity, COST_POP_PER_SOLDIER[type]);
    const maxSoldiers = (intDiv(rawMax, RECRUIT_STEP) * RECRUIT_STEP) as Fp;
    const amounts: RecruitOption['amounts'] = [];
    for (let amount = RECRUIT_MIN; amount <= maxSoldiers; amount = (amount + RECRUIT_STEP) as Fp) {
      amounts.push({
        soldiers: amount,
        check: checkRecruit(state, playerId, cityId, type, amount),
      });
    }
    return { type, amounts };
  });
}

/**
 * Карточка гекса для игрока: проверки строительства, набор, план восстановления снабжения.
 * @returns данные карточки; состояние не меняется
 */
export function selectionFor(state: MatchState, playerId: number, hex: number): Selection {
  const city = state.cities.find((c) => c.hex === hex);
  const info = city ? cityInfo(state, city.id) : null;
  return {
    hex,
    popCap: city ? cityPopCap(city.level) : hexPopCap(state, hex),
    city: info,
    foundCity: canFoundCity(state, playerId, hex),
    improve: checkConstruction(state, playerId, { t: 'improve', hex }),
    fort: checkConstruction(state, playerId, { t: 'build', hex, kind: 'fort' }),
    depot: checkConstruction(state, playerId, { t: 'build', hex, kind: 'depot' }),
    building: state.hexes.building[hex] ?? 0,
    rebuild:
      info?.rebuild ??
      (isDepot(state.hexes.building[hex] ?? 0)
        ? rebuildSupplyPlan(state, playerId, { hex })
        : null),
    recruit: city?.owner === playerId ? recruitOptions(state, playerId, city.id) : [],
  };
}
