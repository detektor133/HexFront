// Закупка под заказ численности армии (07-controls.md, «Меню страны»): армия с `wanted` сначала
// берёт свободный резерв, а недостающее раз в секунду заказывает набором в ближайшем к своему
// фронту городе с пустой очередью; отряд приходит прямо в армию и сам идёт на место по линии.
import {
  PROCURE_BATCH,
  RECRUIT_MIN,
  RECRUIT_STEP,
  TICKS_PER_S,
  type UnitType,
} from '../balance.ts';
import { checkRecruit, startRecruit } from '../commands/recruit.ts';
import { splitUnit } from '../commands/unit.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import { mixNeed } from '../state/mix.ts';
import type { Army, City, MatchState } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

// Гексы, к которым город тянется: линия плана армии, иначе места её отрядов.
function anchors(state: MatchState, army: Army): HexId[] {
  const plan = state.plans.find((p) => p.armyId === army.id);
  if (plan) return planHexes(state, plan);
  return allUnits(state)
    .filter((u) => u.armyId === army.id)
    .map((u) => u.hex);
}

function cityOrder(state: MatchState, army: Army): City[] {
  const { width } = state.map;
  const marks = anchors(state, army).map((h) => hexFromId(h, width));
  const away = (c: City): number =>
    marks.length === 0 ? 0 : Math.min(...marks.map((m) => distance(m, hexFromId(c.hex, width))));
  return state.cities
    .filter((c) => c.owner === army.owner && !state.recruits.some((r) => r.cityId === c.id))
    .sort((a, b) => away(a) - away(b) || a.id - b.id);
}

const strength = (state: MatchState, army: Army): number =>
  allUnits(state)
    .filter((u) => u.armyId === army.id)
    .reduce((sum, u) => sum + u.soldiers, 0) +
  state.recruits.filter((r) => r.armyId === army.id).reduce((sum, r) => sum + r.soldiers, 0);

const TYPES: readonly UnitType[] = ['infantry', 'armor', 'artillery'];

// Солдаты армии определённого типа: в отрядах и в очереди набора.
const strengthOf = (state: MatchState, army: Army, type: UnitType): number =>
  allUnits(state)
    .filter((u) => u.armyId === army.id && u.type === type)
    .reduce((sum, u) => sum + u.soldiers, 0) +
  state.recruits
    .filter((r) => r.armyId === army.id && r.type === type)
    .reduce((sum, r) => sum + r.soldiers, 0);

// Резерв игрока — в армии с нехваткой, ближайшие к её фронту отряды раньше.
function takeReserve(state: MatchState, army: Army): void {
  const { width } = state.map;
  const marks = anchors(state, army).map((h) => hexFromId(h, width));
  const away = (hex: HexId): number =>
    marks.length === 0 ? 0 : Math.min(...marks.map((m) => distance(m, hexFromId(hex, width))));
  const reserve = allUnits(state)
    .filter(
      (u) =>
        u.owner === army.owner &&
        u.armyId === null &&
        u.order === 'idle' &&
        !u.inBattle &&
        u.slot !== SLOT_DETACHED,
    )
    .sort((a, b) => away(a.hex) - away(b.hex) || a.id - b.id);
  const need = mixNeed(army.wanted ?? 0, army.mix);
  let have = strength(state, army);
  for (const u of reserve) {
    if (have >= (army.wanted ?? 0) * FP) return;
    // Состав задан: берём из резерва только тот тип, которого армии не хватает.
    if (need !== undefined && strengthOf(state, army, u.type) >= need[u.type] * FP) continue;
    u.armyId = army.id;
    have += u.soldiers;
  }
}

/**
 * Лимит уменьшен — лишние солдаты уходят в резерв: целые отряды, которые не нужны армии, а если
 * лишнее меньше отряда — отделённая часть. Идут только стоящие отряды вне боя.
 */
function releaseSurplus(state: MatchState, army: Army): void {
  if (army.wanted === undefined) return;
  let surplus =
    allUnits(state)
      .filter((u) => u.armyId === army.id)
      .reduce((sum, u) => sum + u.soldiers, 0) -
    army.wanted * FP;
  if (surplus < FP) return;
  const idle = allUnits(state)
    // Артиллерия в резерв не уходит: она нужна армии за линией, а не в запас.
    .filter(
      (u) => u.armyId === army.id && u.order === 'idle' && !u.inBattle && u.type !== 'artillery',
    )
    .sort((a, b) => a.soldiers - b.soldiers || a.id - b.id);
  for (const unit of idle) {
    if (surplus < FP) return;
    if (unit.soldiers <= surplus) {
      surplus -= unit.soldiers;
      unit.armyId = null;
      unit.slot = -1;
      continue;
    }
    const part = intDiv(surplus, FP) * FP;
    if (part < FP || unit.soldiers - part < FP) continue;
    const piece = splitUnit(state, unit, part as Fp);
    piece.armyId = null;
    piece.slot = -1;
    surplus -= part;
  }
}

/** Добирает резерв и закупает недостающих для армий с заказанной численностью; раз в секунду. */
export function procure(state: MatchState): void {
  if (state.tick % TICKS_PER_S !== 0) return;
  // Справедливо: сначала армия с наименьшей долей заказа — иначе первая по id забирает резерв и
  // очередь единственного города, а остальные направления стоят пустыми.
  const wanting = state.armies
    .filter((a) => a.wanted !== undefined)
    .sort((a, b) => {
      const left = strength(state, a) * (b.wanted ?? 1);
      const right = strength(state, b) * (a.wanted ?? 1);
      return left - right || a.id - b.id;
    });
  for (const army of wanting) {
    if (army.wanted === undefined) continue;
    releaseSurplus(state, army);
    takeReserve(state, army);
    orderOne(state, army);
  }
}

// Одна закупка армии за секунду: нехватка по типу состава (без состава — пехота) в ближайшем городе.
function orderOne(state: MatchState, army: Army): void {
  const need = mixNeed(army.wanted ?? 0, army.mix);
  for (const type of TYPES) {
    const deficit =
      need === undefined
        ? (army.wanted ?? 0) * FP - strength(state, army)
        : need[type] * FP - strengthOf(state, army, type);
    if (need === undefined && type !== 'infantry') return;
    if (deficit < RECRUIT_MIN) continue;
    const batch = intDiv(Math.min(deficit, PROCURE_BATCH), RECRUIT_STEP) * RECRUIT_STEP;
    for (const city of cityOrder(state, army)) {
      for (let amount = batch; amount >= RECRUIT_MIN; amount -= RECRUIT_STEP) {
        if (!checkRecruit(state, army.owner, city.id, type, amount as Fp).ok) continue;
        startRecruit(state, army.owner, city.id, type, amount as Fp, army.id);
        return;
      }
    }
  }
}
