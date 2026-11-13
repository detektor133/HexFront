// Распределение отрядов армий по планам (CR-002): раз в FRONT_ALLOC_TICKS для каждой армии,
// размазано по армиям; перестановка — только при выигрыше покрытия больше порога. Если отрядов
// меньше гексов линии, армия сама делится (CR-005).
// GDD: docs/gdd/07-controls.md — «Планы армий», «Распределение».
import { consolidate } from './consolidate.ts';
import { maintainDirections } from './direction.ts';
import {
  DETACH_REJOIN_TICKS,
  FRONT_ALLOC_TICKS,
  FRONT_HOLD_DENOM,
  FRONT_ROUTES_PER_TICK,
  FRONT_REALLOC_GAIN_MIN,
  FRONT_SPLIT_MIN,
  FRONT_THREAT_RANGE,
} from '../balance.ts';
import { mergeUnits, splitUnit } from '../commands/unit.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { findPath } from '../queries/unit-path.ts';
import { SLOT_DETACHED, allocate, planControls } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import { atWar } from '../state/relations.ts';
import { recentlyLeft } from '../state/return-lock.ts';
import type { ArmyPlan, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

// Путь к месту по своей земле, чтобы не брать чужие гексы по дороге (04/T14b); своя земля бывает
// разорвана — тогда через ничью, но не через чужую.
const safePath = (state: MatchState, u: Unit, from: HexId, to: number): HexId[] | null =>
  findPath(state, from, to, u.type, u.owner, true) ??
  findPath(state, from, to, u.type, u.owner, 'safe');

// Маршрут отряда к месту. Нет безопасного пути — ближайший достижимый гекс линии: отряд не стоит
// без дела из-за разорванной земли. Линии не достать вообще — идёт напрямую, беря чужое по дороге.
function routeTo(
  state: MatchState,
  u: Unit,
  from: HexId,
  slot: number,
  line: readonly HexId[],
): { readonly slot: number; readonly path: HexId[] } | null {
  const direct = safePath(state, u, from, slot);
  if (direct && direct.length > 0) return { slot, path: direct };
  const { width } = state.map;
  const at = hexFromId(from, width);
  const near = line
    .filter((h) => h !== slot)
    .sort((x, y) => distance(at, hexFromId(x, width)) - distance(at, hexFromId(y, width)) || x - y)
    .slice(0, ROUTE_ALTERNATIVES);
  for (const h of near) {
    const path = safePath(state, u, from, h);
    if (path && path.length > 0) return { slot: h, path };
  }
  const forced = findPath(state, from, slot, u.type, u.owner);
  return forced && forced.length > 0 ? { slot, path: forced } : null;
}

// Дешёвая часть: отряд уже на месте, уже идёт на него или доводит начатый шаг. Идущий отряд не
// бросает начатый переход: новый маршрут строится от гекса, в который он уже вступает, а прогресс
// шага сохраняется. Иначе пересмотр мест чаще времени перехода гонял бы отряд «почти дошёл — откат —
// снова» без конца. Возвращает true, если отряду нужен новый маршрут (поиск пути — дорогая часть).
function settle(u: Unit, slot: number): boolean {
  u.slot = slot;
  if (u.hex === slot) {
    // Место — гекс, из которого отряд уже выходит: начатый шаг доводится, откатывать фишку нельзя.
    if (u.order === 'move' && u.moveTotal > 0 && u.path.length > 0) {
      u.path = [u.path[0] as HexId];
      return false;
    }
    if (u.order === 'move') {
      u.path = [];
      u.moveTicks = 0;
      u.moveTotal = 0;
    }
    u.order = 'idle';
    return false;
  }
  if (u.order === 'move' && u.path.at(-1) === slot) return false;
  const entering = u.order === 'move' && u.moveTotal > 0 ? u.path[0] : undefined;
  if (entering === slot) {
    u.path = [slot];
    return false;
  }
  return true;
}

// Дорогая часть: маршрут к месту.
function routeUnit(state: MatchState, u: Unit, slot: number, line: readonly HexId[]): void {
  const entering = u.order === 'move' && u.moveTotal > 0 ? u.path[0] : undefined;
  const route = routeTo(state, u, entering ?? u.hex, slot, line);
  if (!route) {
    u.slot = -1;
    // Нет пути дальше — отряд заканчивает начатый шаг и встаёт, а не откатывается.
    if (entering !== undefined) u.path = [entering];
    return;
  }
  u.slot = route.slot;
  if (entering === undefined) {
    u.path = route.path;
    u.moveTicks = 0;
    u.moveTotal = 0;
  } else {
    u.path = [entering, ...route.path];
  }
  u.order = 'move';
}

/** Сколько других гексов линии пробуем, когда путь к назначенному месту закрыт. */
const ROUTE_ALTERNATIVES = 6;

// Сколько отрядов нужно линии: по отряду на каждый гекс — пробелов нет ни на каких участках.
const coverNeed = (state: MatchState, plan: ArmyPlan): number => planHexes(state, plan).length;

// Сила врага рядом с гексом (в солдатах): чужие отряды в пределах FRONT_THREAT_RANGE гексов.
function enemyNear(hex: number, width: number, foes: readonly Unit[]): number {
  let strength = 0;
  const at = hexFromId(hex, width);
  for (const u of foes) {
    if (distance(at, hexFromId(u.hex, width)) <= FRONT_THREAT_RANGE) strength += u.soldiers;
  }
  return strength;
}

/**
 * Автоделение (05-armies.md, CR-005): пока пехоты и брони армии меньше, чем гексов линии,
 * самый большой отряд (при равенстве — меньший id) делится пополам, если обе половины не меньше
 * FRONT_SPLIT_MIN и в его гексе есть место.
 */
function coverLine(state: MatchState, armyId: number, owner: number): void {
  const plan = state.plans.find((p) => p.armyId === armyId);
  if (!plan) return;
  const need = coverNeed(state, plan);
  const { width } = state.map;
  for (;;) {
    const units = allUnits(state).filter((u) => planControls(u, armyId) && u.type !== 'artillery');
    // Глобального лимита отрядов нет (DECISIONS 2026-10-02): ограничивает только минимум деления.
    if (units.length >= need) return;
    const foes = allUnits(state).filter((u) => u.owner !== owner && atWar(state, owner, u.owner));
    let best: Unit | null = null;
    for (const u of units) {
      // Адаптивно: у сильного врага отряд делится не мельче, чем держит долю его силы (каждая часть
      // — не меньше 1/FRONT_HOLD_DENOM силы врага рядом), у тихого участка — до FRONT_SPLIT_MIN.
      const hold = Math.max(
        FRONT_SPLIT_MIN,
        intDiv(enemyNear(u.hex, width, foes), FRONT_HOLD_DENOM),
      );
      if (u.soldiers < 2 * hold) continue;
      if (!best || u.soldiers > best.soldiers) best = u;
    }
    if (!best) return;
    splitUnit(state, best, (intDiv(intDiv(best.soldiers, FP), 2) * FP) as Fp);
  }
}

const bySize = (a: Unit, b: Unit): number => a.soldiers - b.soldiers || a.id - b.id;

// Одно слияние за распределение: пара должна быть однотипной, в одном гексе и не в бою.
// Только для армии с планом (фронт/наступление/оборона) — её расстановку ведёт commander
// (решение владельца 2026-11-02); армия без плана не сливается сама, только вручную.
function autoMerge(state: MatchState, plan: ArmyPlan): void {
  const need = coverNeed(state, plan);
  const armyUnits = allUnits(state).filter(
    (u) => planControls(u, plan.armyId) && u.type !== 'artillery',
  );
  const eligible = armyUnits.filter((u) => !u.inBattle);
  for (const type of ['infantry', 'armor'] as const) {
    const sameType = armyUnits.filter((u) => u.type === type);
    if (sameType.length <= need) continue;
    const candidates = eligible.filter((u) => u.type === type).sort(bySize);
    for (const first of candidates) {
      const second = candidates.find((u) => u.id !== first.id && u.hex === first.hex);
      if (!second) continue;
      mergeUnits(state, [first, second]);
      return;
    }
  }
}

// Отряд, снятый с плана ручным приказом, простоял без шага и боя DETACH_REJOIN_TICKS — план берёт
// его обратно (иначе после своей атаки он навсегда оставался бы на месте приказа).
function rejoinIdle(state: MatchState, armyId: number): void {
  for (const u of allUnits(state)) {
    if (u.armyId !== armyId || u.slot !== SLOT_DETACHED) continue;
    if (u.order !== 'idle' || u.inBattle || u.sea) continue;
    if (u.cameTick !== undefined && state.tick - u.cameTick < DETACH_REJOIN_TICKS) continue;
    u.slot = -1;
  }
}

function runPlan(state: MatchState, armyId: number): void {
  const plan = state.plans.find((p) => p.armyId === armyId);
  if (!plan) return;
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (owner === undefined) return;
  rejoinIdle(state, armyId);
  autoMerge(state, plan);
  coverLine(state, armyId, owner);
  const next = allocate(state, plan, owner);
  const units = allUnits(state).filter((u) => planControls(u, plan.armyId));
  // Против «дрожания»: при малом выигрыше покрытия стоящие отряды остаются, а место ищется лишь
  // новым и тем, у кого линия ушла из-под ног (новый отряд не перетасовывает всю армию).
  const keep =
    next.coverage <= next.keptCoverage + fpMul(next.keptCoverage as Fp, FRONT_REALLOC_GAIN_MIN);
  const chosen = keep ? next.kept : next.slots;
  // Места назначаются сразу всем; маршруты строит routePending — по очереди, каждый тик.
  for (const u of units) {
    const slot = chosen.get(u.id);
    if (slot === undefined) u.slot = -1;
    else settle(u, slot);
  }
}

/**
 * Поиск пути дорог для сотен отрядов разом останавливал игру на секунды, поэтому маршруты строятся
 * не за расстановку, а каждый тик по FRONT_ROUTES_PER_TICK штук на все армии. Очередь не хранится:
 * ждёт тот, у кого место назначено, а пути к нему нет. Первыми идут ближние к месту (быстрее встают
 * в строй и дешевле поиск), при равенстве — меньший id; армии обходятся по кругу, чтобы большая не
 * держала малую. Отряд без маршрута не простаивает дольше, чем очередь впереди него.
 */
function routePending(state: MatchState): void {
  const { plans } = state;
  if (plans.length === 0) return;
  const { width } = state.map;
  // Один проход по отрядам матча: ждущие группируются по армии с планом.
  const planned = new Set(plans.map((p) => p.armyId));
  const waiting = new Map<number, { u: Unit; d: number }[]>();
  for (const u of allUnits(state)) {
    const army = u.armyId;
    if (army === null || u.slot < 0 || !planned.has(army) || !planControls(u, army)) continue;
    if (!settle(u, u.slot)) continue;
    // Место — гекс, из которого отряд только что вышел: подождать, а не гонять туда-обратно.
    if (recentlyLeft(state, u, u.slot)) continue;
    const list = waiting.get(army) ?? [];
    list.push({ u, d: distance(hexFromId(u.hex, width), hexFromId(u.slot, width)) });
    waiting.set(army, list);
  }
  if (waiting.size === 0) return;
  let left = FRONT_ROUTES_PER_TICK;
  const start = state.tick % plans.length;
  for (let k = 0; k < plans.length && left > 0; k += 1) {
    const plan = plans[(start + k) % plans.length] as ArmyPlan;
    const queue = waiting.get(plan.armyId);
    if (!queue) continue;
    queue.sort((x, y) => x.d - y.d || x.u.id - y.u.id);
    const line = planHexes(state, plan);
    for (const { u } of queue) {
      if (left <= 0) break;
      left -= 1;
      routeUnit(state, u, u.slot, line);
    }
  }
}

/** Раз в FRONT_ALLOC_TICKS раздаёт места отрядам армии с планом; армии — в разные тики.
 * Армия без плана не трогается — слияние и расстановка её отрядов только вручную. */
export function frontSystem(state: MatchState): void {
  maintainDirections(state);
  consolidate(state);
  for (const plan of state.plans) {
    if ((state.tick + plan.armyId) % FRONT_ALLOC_TICKS === 0) runPlan(state, plan.armyId);
  }
  routePending(state);
}
