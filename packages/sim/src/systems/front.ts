// Распределение отрядов армий по планам (CR-002): раз в FRONT_ALLOC_TICKS для каждой армии,
// размазано по армиям; перестановка — только при выигрыше покрытия больше порога. Если отрядов
// меньше гексов линии, армия сама делится (CR-005).
// GDD: docs/gdd/07-controls.md — «Планы армий», «Распределение».
import { consolidate } from './consolidate.ts';
import { maintainDirections } from './direction.ts';
import {
  FRONT_ALLOC_TICKS,
  FRONT_HOLD_DENOM,
  FRONT_ROUTE_BUDGET,
  FRONT_REALLOC_GAIN_MIN,
  FRONT_SPLIT_MIN,
  FRONT_THREAT_RANGE,
} from '../balance.ts';
import { mergeUnits, splitUnit } from '../commands/unit.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, fpMul, intDiv, type Fp } from '../math/int.ts';
import { findPath } from '../queries/unit-path.ts';
import { allocate, planControls } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import { atWar } from '../state/relations.ts';
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

// Отряд идёт на своё место или встаёт на нём в оборону. Идущий отряд не бросает начатый переход:
// новый маршрут строится от гекса, в который он уже вступает, а прогресс шага сохраняется. Иначе
// пересмотр мест чаще времени перехода гонял бы отряд «почти дошёл — откат — снова» без конца.
function goTo(
  state: MatchState,
  u: Unit,
  slot: number,
  line: readonly HexId[],
  budget: { left: number },
): void {
  u.slot = slot;
  if (u.hex === slot) {
    // Место — гекс, из которого отряд уже выходит: начатый шаг доводится, откатывать фишку нельзя.
    if (u.order === 'move' && u.moveTotal > 0 && u.path.length > 0) {
      u.path = [u.path[0] as HexId];
      return;
    }
    if (u.order === 'move') {
      u.path = [];
      u.moveTicks = 0;
      u.moveTotal = 0;
    }
    u.order = 'idle';
    return;
  }
  if (u.order === 'move' && u.path.at(-1) === slot) return;
  const entering = u.order === 'move' && u.moveTotal > 0 ? u.path[0] : undefined;
  if (entering === slot) {
    u.path = [slot];
    return;
  }
  // Поиск путей дорог: сотни отрядов, меняющих место разом, останавливали игру на секунды. За одну
  // расстановку маршрут получают не больше FRONT_ROUTE_BUDGET отрядов армии, остальные — в следующую.
  if (budget.left <= 0) return;
  budget.left -= 1;
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

function runPlan(state: MatchState, armyId: number): void {
  const plan = state.plans.find((p) => p.armyId === armyId);
  if (!plan) return;
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (owner === undefined) return;
  autoMerge(state, plan);
  coverLine(state, armyId, owner);
  const next = allocate(state, plan, owner);
  const units = allUnits(state).filter((u) => planControls(u, plan.armyId));
  // Против «дрожания»: при малом выигрыше покрытия стоящие отряды остаются, а место ищется лишь
  // новым и тем, у кого линия ушла из-под ног (новый отряд не перетасовывает всю армию).
  const keep =
    next.coverage <= next.keptCoverage + fpMul(next.keptCoverage as Fp, FRONT_REALLOC_GAIN_MIN);
  const chosen = keep ? next.kept : next.slots;
  const budget = { left: FRONT_ROUTE_BUDGET };
  for (const u of units) {
    const slot = chosen.get(u.id);
    if (slot === undefined) u.slot = -1;
    else goTo(state, u, slot, next.line, budget);
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
}
