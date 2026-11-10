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
  DEPOT_MIN_DISTANCE,
  DEPOT_UPGRADE_COST,
  DEPOT_UPGRADE_TIME_S,
  DEPOT_TIME_S,
  FORT_COST,
  FORT_TIME_S,
  FORT_UPGRADE_COST,
  FORT_UPGRADE_TIME_S,
  IMPROVEMENT_COST,
  IMPROVEMENT_TIME_S,
  TICKS_PER_S,
} from '../balance.ts';
import { OK, rejected, type Command, type RejectReason, type Validation } from './types.ts';
import { distance, hexDistanceById, hexFromId, hexId, inBounds, type HexId } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { depotLevel, isDepot } from '../state/depot.ts';
import { fortLevel } from '../state/fort.ts';
import { hexPopCap } from '../state/pop-cap.ts';
import { type ConstructionKind, type MatchState } from '../state/types.ts';

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
  const { width } = state.map;
  for (const c of state.cities) {
    if (hexDistanceById(c.hex, hex, width) < CITY_MIN_DISTANCE) return true;
  }
  for (const c of state.constructions) {
    if (c.kind === 'foundCity' && hexDistanceById(c.hex, hex, width) < CITY_MIN_DISTANCE) {
      return true;
    }
  }
  return false;
}

// Склад не ближе DEPOT_MIN_DISTANCE к СВОЕМУ складу или городу: чужой город или склад на границе
// строить не мешает (склад у врага — не повод оставлять свою армию без снабжения). Склады ищем в
// кольце радиуса DEPOT_MIN_DISTANCE − 1 вокруг гекса, а не по всей карте. Строящиеся склады и города
// считаются так же, как готовые: иначе рядом со стройкой можно заложить второй склад.
function tooCloseToDepot(state: MatchState, playerId: number, hex: HexId): boolean {
  const { width, height } = state.map;
  const candidate = hexFromId(hex, width);
  const sites = [
    ...state.cities.filter((c) => c.owner === playerId).map((c) => c.hex),
    ...state.constructions
      .filter((c) => (c.kind === 'foundCity' || c.kind === 'depot') && c.owner === playerId)
      .map((c) => c.hex),
  ];
  if (
    sites.some(
      (site) => site !== hex && distance(hexFromId(site, width), candidate) < DEPOT_MIN_DISTANCE,
    )
  ) {
    return true;
  }
  const reach = DEPOT_MIN_DISTANCE - 1;
  for (let dq = -reach; dq <= reach; dq += 1) {
    for (let dr = Math.max(-reach, -dq - reach); dr <= Math.min(reach, -dq + reach); dr += 1) {
      const near = { q: candidate.q + dq, r: candidate.r + dr };
      if (!inBounds(near, width, height)) continue;
      const site = hexId(near, width);
      const own = state.hexes.owner[site] === playerId;
      if (site !== hex && own && isDepot(state.hexes.building[site] ?? 0)) return true;
    }
  }
  return false;
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
  // Склад на гексе со складом — улучшение до следующего уровня.
  const level = depotLevel(state.hexes.building[hex] ?? 0);
  if (kind === 'depot' && level > 0) {
    const cost = DEPOT_UPGRADE_COST[level - 1];
    const timeS = DEPOT_UPGRADE_TIME_S[level - 1];
    if (cost === undefined || timeS === undefined) return fail('maxLevel');
    return plan({ kind: 'upgradeDepot', hex, cost, timeS });
  }
  // Укрепление на гексе с укреплением — улучшение до следующего уровня (до укрепрайона).
  const fort = fortLevel(state.hexes.building[hex] ?? 0);
  if (kind === 'fort' && fort > 0) {
    const cost = FORT_UPGRADE_COST[fort - 1];
    const timeS = FORT_UPGRADE_TIME_S[fort - 1];
    if (cost === undefined || timeS === undefined) return fail('maxLevel');
    return plan({ kind: 'upgradeFort', hex, cost, timeS });
  }
  // Укрепление и склад на одном гексе ставятся вместе: своё здание уже улучшается выше, чужого не ждём.
  if (kind === 'fort') {
    // У города своя оборона ×1,3, укрепление в нём не ставится.
    if (cityAt(state, hex)) return fail('fortInCity');
    return plan({ kind, hex, cost: FORT_COST, timeS: FORT_TIME_S });
  }
  if (tooCloseToDepot(state, playerId, hex)) return fail('depotTooClose');
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
  if (state.players[playerId]?.bankrupt) return fail('bankrupt');
  const gold = state.players[playerId]?.gold ?? 0;
  return gold < result.plan.cost ? fail('notEnoughGold') : result;
}

/** Результат проверки стройки для UI: цена и время или причина отказа. */
export type ConstructionCheck =
  | { readonly ok: true; readonly cost: Fp; readonly timeS: Fp }
  | {
      readonly ok: false;
      readonly reason: RejectReason;
      /** Есть, когда не хватает только золота: интерфейс показывает цену (ui.md). */
      readonly cost?: Fp;
      readonly timeS?: Fp;
    };

/**
 * Проверка стройки с ценой — одна логика для команды и для кнопок интерфейса.
 * @returns цена (золото) и время (с) в fixed-point или причина отказа
 */
export function checkConstruction(
  state: MatchState,
  playerId: number,
  cmd: BuildCommand,
): ConstructionCheck {
  const planned = planOf(state, playerId, cmd);
  if (!planned.ok) return planned;
  const { cost, timeS } = planned.plan;
  const result = withGold(state, playerId, planned);
  if (result.ok) return { ok: true, cost, timeS };
  return result.reason === 'notEnoughGold'
    ? { ok: false, reason: 'notEnoughGold', cost, timeS }
    : { ok: false, reason: result.reason };
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
