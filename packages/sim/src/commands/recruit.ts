// Команда recruit: проверка, списание людей и золота, постановка в очередь города.
// GDD: docs/gdd/05-units.md — «Модель», «Набор»; 02-economy.md — «Банкротство».
import {
  UNIT_LIMIT_BASE,
  UNIT_LIMIT_PER_CITY,
  COST_GOLD_PER_SOLDIER,
  COST_POP_PER_SOLDIER,
  RECRUIT_BASE_S,
  RECRUIT_MIN,
  RECRUIT_MIN_HEX_POP_RATIO,
  RECRUIT_PER_100_S,
  RECRUIT_STEP,
  TICKS_PER_S,
  type UnitType,
} from '../balance.ts';
import { OK, rejected, type RejectReason, type Validation } from './types.ts';
import { hexFromId, hexId, inBounds, spiral, type HexId } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { cityPopCap, hexPopCap } from '../state/pop-cap.ts';
import type { City, MatchState } from '../state/types.ts';

/** Радиус, из которого город набирает людей: городской гекс и кольца 1–2. */
const RECRUIT_RADIUS = 2;

/** Сколько солдат составляют «100» в формуле времени набора. */
const SOLDIERS_PER_TIME_STEP = 100;

interface Donor {
  readonly hex: HexId;
  /** Сколько людей гекс может отдать, не опускаясь ниже 10 % лимита; fixed-point. */
  readonly surplus: number;
}

// Гексы владельца города в радиусе 2 по возрастанию HexId — стабильный порядок для остатков.
function donors(state: MatchState, city: City): Donor[] {
  const { width, height } = state.map;
  const result: Donor[] = [];
  for (const h of spiral(hexFromId(city.hex, width), RECRUIT_RADIUS)) {
    if (!inBounds(h, width, height)) continue;
    const id = hexId(h, width);
    if (state.hexes.owner[id] !== city.owner) continue;
    const here = state.cities.find((c) => c.hex === id);
    const cap = here ? cityPopCap(here.level) : hexPopCap(state, id);
    const floor = fpMul(cap, RECRUIT_MIN_HEX_POP_RATIO);
    const surplus = Math.max(0, (state.hexes.pop[id] ?? 0) - floor);
    if (surplus > 0) result.push({ hex: id, surplus });
  }
  return result.sort((a, b) => a.hex - b.hex);
}

/**
 * Сколько людей город может отдать в отряды: сумма излишков над 10 % лимита по своим гексам
 * в радиусе 2.
 * @returns fixed-point людей; 0 для неизвестного города
 */
export function recruitCapacity(state: MatchState, cityId: number): Fp {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return 0 as Fp;
  return donors(state, city).reduce((sum, d) => sum + d.surplus, 0) as Fp;
}

/**
 * Командная ёмкость: UNIT_LIMIT_BASE + UNIT_LIMIT_PER_CITY × городов игрока.
 * @returns сколько отрядов (вместе с наборами в очереди) может быть у игрока
 */
export function unitLimit(state: MatchState, playerId: number): number {
  const cities = state.cities.filter((c) => c.owner === playerId).length;
  return UNIT_LIMIT_BASE + UNIT_LIMIT_PER_CITY * cities;
}

/**
 * Время набора: RECRUIT_BASE_S + RECRUIT_PER_100_S × soldiers / 100.
 * @returns секунды, fixed-point
 */
export function recruitTimeS(type: UnitType, soldiers: Fp): Fp {
  const hundreds = intDiv(soldiers, SOLDIERS_PER_TIME_STEP) as Fp;
  return (RECRUIT_BASE_S[type] + fpMul(RECRUIT_PER_100_S[type], hundreds)) as Fp;
}

/** Результат проверки набора для UI: цена и время или причина отказа. */
export type RecruitCheck =
  | { readonly ok: true; readonly cost: Fp; readonly timeS: Fp }
  | { readonly ok: false; readonly reason: RejectReason; readonly cost?: Fp; readonly timeS?: Fp };

const fail = (reason: RejectReason): RecruitCheck => ({ ok: false, reason });

function isUnitType(type: string): type is UnitType {
  return Object.hasOwn(COST_GOLD_PER_SOLDIER, type);
}

// Всё, кроме золота: отказ без цены.
function checkRules(
  state: MatchState,
  playerId: number,
  cityId: number,
  type: UnitType,
  soldiers: Fp,
): RejectReason | null {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return 'unknownCity';
  if (city.owner !== playerId) return 'notOwnCity';
  if (!isUnitType(type)) return 'badUnitType';
  if (!Number.isInteger(soldiers) || soldiers < RECRUIT_MIN || soldiers % RECRUIT_STEP !== 0) {
    return 'invalidAmount';
  }
  if (state.players[playerId]?.bankrupt) return 'bankrupt';
  if (state.recruits.some((r) => r.cityId === cityId)) return 'queueBusy';
  const used =
    state.units.filter((a) => a.owner === playerId).length +
    state.recruits.filter((r) => r.owner === playerId).length;
  if (used >= unitLimit(state, playerId)) return 'unitLimit';
  if (recruitCapacity(state, cityId) < fpMul(soldiers, COST_POP_PER_SOLDIER[type])) {
    return 'notEnoughPeople';
  }
  return null;
}

/**
 * Проверка набора с ценой — одна логика для команды и для интерфейса.
 * @returns цена (золото) и время (с) в fixed-point или причина отказа
 */
export function checkRecruit(
  state: MatchState,
  playerId: number,
  cityId: number,
  type: UnitType,
  soldiers: Fp,
): RecruitCheck {
  const reason = checkRules(state, playerId, cityId, type, soldiers);
  if (reason) return fail(reason);
  const cost = fpMul(soldiers, COST_GOLD_PER_SOLDIER[type]);
  const timeS = recruitTimeS(type, soldiers);
  const gold = state.players[playerId]?.gold ?? 0;
  if (gold < cost) return { ok: false, reason: 'notEnoughGold', cost, timeS };
  return { ok: true, cost, timeS };
}

/**
 * Проверяет команду набора без изменения состояния.
 * @returns OK или отказ с причиной
 */
export function validateRecruit(
  state: MatchState,
  playerId: number,
  cityId: number,
  type: UnitType,
  soldiers: Fp,
): Validation {
  const check = checkRecruit(state, playerId, cityId, type, soldiers);
  return check.ok ? OK : rejected(check.reason);
}

// Люди берутся пропорционально излишку гекса, поэтому ни один гекс не опускается ниже 10 %
// лимита; остаток от усечения — по 1 FP в порядке HexId.
function takePeople(state: MatchState, city: City, need: number): void {
  const list = donors(state, city);
  const total = list.reduce((sum, d) => sum + d.surplus, 0);
  const takes = list.map((d) => intDiv(need * d.surplus, total));
  let rest = need - takes.reduce((sum, t) => sum + t, 0);
  while (rest > 0) {
    list.forEach((d, i) => {
      const take = takes[i] ?? 0;
      if (rest > 0 && take < d.surplus) {
        takes[i] = take + 1;
        rest -= 1;
      }
    });
  }
  list.forEach((d, i) => {
    state.hexes.pop[d.hex] = (state.hexes.pop[d.hex] ?? 0) - (takes[i] ?? 0);
  });
}

/** Списывает людей и золото и ставит набор в очередь города. Только после успешной проверки. */
export function startRecruit(
  state: MatchState,
  playerId: number,
  cityId: number,
  type: UnitType,
  soldiers: Fp,
): void {
  const check = checkRecruit(state, playerId, cityId, type, soldiers);
  const player = state.players[playerId];
  const city = state.cities.find((c) => c.id === cityId);
  if (!check.ok || !player || !city) return;
  player.gold = (player.gold - check.cost) as Fp;
  takePeople(state, city, fpMul(soldiers, COST_POP_PER_SOLDIER[type]));
  state.recruits.push({
    id: state.nextId,
    owner: playerId,
    cityId,
    type,
    soldiers,
    progressTicks: 0,
    totalTicks: intDiv(check.timeS * TICKS_PER_S, FP),
  });
  state.nextId += 1;
}
