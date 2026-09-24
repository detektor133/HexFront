// Команды строек: foundCity, upgradeCity, improve, build. Проверка условий и запуск стройки.
// GDD: docs/gdd/03-cities-buildings.md — «Основание города», «Улучшение», «Благоустройство», «Постройки».
import {
  CITY_FOUND_BASE_COST,
  CITY_FOUND_COST_STEP,
  CITY_FOUND_MIN_POP_RATIO,
  CITY_FOUND_TIME_S,
  CITY_MIN_DISTANCE,
  CITY_UPGRADE_COST,
  CITY_UPGRADE_TIME_S,
  DEPOT_COST,
  DEPOT_TIME_S,
  FORT_COST,
  FORT_TIME_S,
  IMPROVEMENT_COST,
  IMPROVEMENT_TIME_S,
  TICKS_PER_S,
} from '../balance.ts';
import { OK, rejected, type Command, type RejectReason, type Validation } from './types.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { hexPopCap } from '../state/pop-cap.ts';
import { BUILDING, type ConstructionKind, type MatchState } from '../state/types.ts';

type BuildCommand = Extract<Command, { t: 'foundCity' | 'upgradeCity' | 'improve' | 'build' }>;

/** Что будет построено: вид, гекс, цена и время. */
interface Plan {
  readonly kind: ConstructionKind;
  readonly hex: HexId;
  readonly cost: Fp;
  readonly timeS: Fp;
}

type PlanResult =
  | { readonly ok: true; readonly plan: Plan }
  | { readonly ok: false; readonly reason: RejectReason };

const fail = (reason: RejectReason): PlanResult => ({ ok: false, reason });
const plan = (p: Plan): PlanResult => ({ ok: true, plan: p });

const cityAt = (state: MatchState, hex: HexId) => state.cities.find((c) => c.hex === hex);
// Прокладка дороги не занимает гекс: пока она идёт, в городе можно строить.
const busy = (state: MatchState, hex: HexId): boolean =>
  state.constructions.some((c) => c.hex === hex && c.kind !== 'road');

/**
 * Цена основания города: 120 × (1 + 0,5 × N), N — сколько городов игрок уже основал.
 * @returns золото, fixed-point
 */
export function foundCityCost(citiesFounded: number): Fp {
  return fpMul(CITY_FOUND_BASE_COST, (FP + CITY_FOUND_COST_STEP * citiesFounded) as Fp);
}

// Условия, общие для стройки на своём гексе.
function ownFreeHex(state: MatchState, playerId: number, hex: HexId): RejectReason | null {
  if (!Number.isInteger(hex) || hex < 0 || hex >= state.hexes.owner.length) return 'badHex';
  if (state.hexes.owner[hex] !== playerId) return 'notOwnHex';
  if (busy(state, hex)) return 'hexBusy';
  return null;
}

// Дистанция ≥ 4 до любого города, включая города в процессе основания.
function tooCloseToCity(state: MatchState, hex: HexId): boolean {
  const h = hexFromId(hex, state.map.width);
  const sites = [
    ...state.cities.map((c) => c.hex),
    ...state.constructions.filter((c) => c.kind === 'foundCity').map((c) => c.hex),
  ];
  return sites.some((site) => distance(hexFromId(site, state.map.width), h) < CITY_MIN_DISTANCE);
}

function planFoundCity(state: MatchState, playerId: number, hex: HexId): PlanResult {
  const base = ownFreeHex(state, playerId, hex);
  if (base) return fail(base);
  if (cityAt(state, hex)) return fail('isCity');
  if (tooCloseToCity(state, hex)) return fail('cityTooClose');
  const minPop = fpMul(hexPopCap(state, hex), CITY_FOUND_MIN_POP_RATIO);
  if ((state.hexes.pop[hex] ?? 0) < minPop) return fail('popTooLow');
  const citiesFounded = state.players[playerId]?.citiesFounded ?? 0;
  return plan({
    kind: 'foundCity',
    hex,
    cost: foundCityCost(citiesFounded),
    timeS: CITY_FOUND_TIME_S,
  });
}

function planUpgrade(state: MatchState, playerId: number, cityId: number): PlanResult {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) return fail('unknownCity');
  if (city.owner !== playerId) return fail('notOwnCity');
  if (busy(state, city.hex)) return fail('hexBusy');
  const cost = CITY_UPGRADE_COST[city.level - 1];
  const timeS = CITY_UPGRADE_TIME_S[city.level - 1];
  if (cost === undefined || timeS === undefined) return fail('maxLevel');
  return plan({ kind: 'upgradeCity', hex: city.hex, cost, timeS });
}

function planImprove(state: MatchState, playerId: number, hex: HexId): PlanResult {
  const base = ownFreeHex(state, playerId, hex);
  if (base) return fail(base);
  if (cityAt(state, hex)) return fail('isCity');
  const level = state.hexes.improvement[hex] ?? 0;
  const cost = IMPROVEMENT_COST[level];
  const timeS = IMPROVEMENT_TIME_S[level];
  if (cost === undefined || timeS === undefined) return fail('maxLevel');
  return plan({ kind: 'improve', hex, cost, timeS });
}

function planBuild(
  state: MatchState,
  playerId: number,
  hex: HexId,
  kind: 'fort' | 'depot',
): PlanResult {
  const base = ownFreeHex(state, playerId, hex);
  if (base) return fail(base);
  if (state.hexes.building[hex] !== BUILDING.none) return fail('buildingExists');
  if (kind === 'fort') {
    // У города своя оборона ×1,3, укрепление в нём не ставится.
    if (cityAt(state, hex)) return fail('fortInCity');
    return plan({ kind, hex, cost: FORT_COST, timeS: FORT_TIME_S });
  }
  if (state.hexes.road[hex] !== 1) return fail('depotNeedsRoad');
  return plan({ kind, hex, cost: DEPOT_COST, timeS: DEPOT_TIME_S });
}

function planOf(state: MatchState, playerId: number, cmd: BuildCommand): PlanResult {
  switch (cmd.t) {
    case 'foundCity':
      return planFoundCity(state, playerId, cmd.hex);
    case 'upgradeCity':
      return planUpgrade(state, playerId, cmd.cityId);
    case 'improve':
      return planImprove(state, playerId, cmd.hex);
    case 'build':
      return planBuild(state, playerId, cmd.hex, cmd.kind);
  }
}

function withGold(state: MatchState, playerId: number, result: PlanResult): PlanResult {
  if (!result.ok) return result;
  const gold = state.players[playerId]?.gold ?? 0;
  return gold < result.plan.cost ? fail('notEnoughGold') : result;
}

/**
 * Проверяет команду стройки без изменения состояния.
 * @returns OK или отказ с причиной
 */
export function validateConstruction(
  state: MatchState,
  playerId: number,
  cmd: BuildCommand,
): Validation {
  const result = withGold(state, playerId, planOf(state, playerId, cmd));
  return result.ok ? OK : rejected(result.reason);
}

/** Списывает золото и ставит стройку в очередь. Вызывается только после успешной проверки. */
export function startConstruction(state: MatchState, playerId: number, cmd: BuildCommand): void {
  const result = withGold(state, playerId, planOf(state, playerId, cmd));
  const player = state.players[playerId];
  if (!result.ok || !player) return;
  const { kind, hex, cost, timeS } = result.plan;
  player.gold = (player.gold - cost) as Fp;
  if (kind === 'foundCity') player.citiesFounded += 1;
  state.constructions.push({
    id: state.nextId,
    owner: playerId,
    hex,
    kind,
    progressTicks: 0,
    totalTicks: intDiv(timeS * TICKS_PER_S, FP),
  });
  state.nextId += 1;
}
