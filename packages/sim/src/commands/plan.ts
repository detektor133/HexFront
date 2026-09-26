// Команды планов армий (CR-002…CR-004): assignFront, setDefenseLine, clearPlan, setOffensiveLine,
// stopOffensive. Фронт и линия наступления задаются гранями.
// GDD: docs/gdd/07-controls.md — «Планы армий».
import { OK, rejected, type Command, type Validation } from './types.ts';
import { MAX_ACTIVE_ARROWS } from '../balance.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import {
  edgeHex,
  edgeOther,
  flipEdge,
  frontEdgePath,
  isBorderEdge,
  isLandEdge,
  landEdgePath,
  type EdgeId,
} from '../state/edges.ts';
import { defenseLinePath, planHexes } from '../state/front.ts';
import type { ArmyPlan, MatchState, OffensiveLine } from '../state/types.ts';

export type PlanCommand = Extract<
  Command,
  { t: 'assignFront' | 'setDefenseLine' | 'clearPlan' | 'setOffensiveLine' | 'stopOffensive' }
>;

const inMap = (state: MatchState, e: EdgeId): boolean =>
  Number.isInteger(e) && e >= 0 && e < state.map.width * state.map.height * 6;

function ownArmy(state: MatchState, playerId: number, armyId: number): Validation {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army) return rejected('unknownArmy');
  return army.owner === playerId ? OK : rejected('notOwnArmy');
}

function validateFront(
  state: MatchState,
  playerId: number,
  cmd: Extract<PlanCommand, { t: 'assignFront' }>,
): Validation {
  // Точки участка — грани своей нынешней границы (с врагом или ничьей землёй).
  if (cmd.edges.length === 0 || cmd.edges.some((e) => !inMap(state, e))) return rejected('badHex');
  if (
    cmd.edges.some(
      (e) =>
        !isBorderEdge(state, playerId, e) && !isBorderEdge(state, playerId, flipEdge(state, e)),
    )
  ) {
    return rejected('badHex');
  }
  return frontEdgePath(state, playerId, cmd.edges) ? OK : rejected('noPath');
}

function validateLine(state: MatchState, playerId: number, points: readonly number[]): Validation {
  if (points.length === 0) return rejected('badHex');
  if (points.some((h) => state.hexes.owner[h] !== playerId)) return rejected('notOwnHex');
  return defenseLinePath(state, playerId, points) ? OK : rejected('noPath');
}

// Наступление — только у армии с линией фронта; активных наступлений у игрока не больше
// MAX_ACTIVE_ARROWS (07-controls.md, «Линия наступления»).
function validateOffensive(
  state: MatchState,
  playerId: number,
  cmd: Extract<PlanCommand, { t: 'setOffensiveLine' }>,
): Validation {
  const plan = state.plans.find((p) => p.armyId === cmd.armyId);
  if (plan?.kind !== 'front') return rejected('noFront');
  if (cmd.edges.length === 0 || cmd.edges.some((e) => !inMap(state, e) || !isLandEdge(state, e))) {
    return rejected('badHex');
  }
  if (!landEdgePath(state, cmd.edges)) return rejected('noPath');
  const mine = new Set(state.armies.filter((a) => a.owner === playerId).map((a) => a.id));
  const active = state.plans.filter(
    (p) => p.kind === 'front' && p.offensive && p.armyId !== cmd.armyId && mine.has(p.armyId),
  ).length;
  return active < MAX_ACTIVE_ARROWS ? OK : rejected('tooManyOffensives');
}

/**
 * Проверяет команду плана без изменения состояния.
 * @returns OK или отказ с причиной
 */
export function validatePlanCommand(
  state: MatchState,
  playerId: number,
  cmd: PlanCommand,
): Validation {
  const army = ownArmy(state, playerId, cmd.armyId);
  if (!army.ok) return army;
  if (cmd.t === 'assignFront') return validateFront(state, playerId, cmd);
  if (cmd.t === 'setDefenseLine') return validateLine(state, playerId, cmd.points);
  if (cmd.t === 'setOffensiveLine') return validateOffensive(state, playerId, cmd);
  return OK;
}

/** Снимает план армии; места отрядов освобождаются, отряды остаются, где стоят. */
export function removePlan(state: MatchState, armyId: number): void {
  const rest = state.plans.filter((p) => p.armyId !== armyId);
  state.plans.splice(0, state.plans.length, ...rest);
  for (const u of state.units) if (u.armyId === armyId) u.slot = -1;
}

// Гексы линии наступления: у каждой грани — гекс, ближе к фронту армии (при равенстве — свой).
function offensiveLine(state: MatchState, plan: ArmyPlan, edges: readonly EdgeId[]): OffensiveLine {
  const front = planHexes(state, plan).map((h) => hexFromId(h, state.map.width));
  const dist = (h: HexId): number => {
    const at = hexFromId(h, state.map.width);
    return front.reduce((m, f) => Math.min(m, distance(at, f)), Number.MAX_SAFE_INTEGER);
  };
  const hexes: HexId[] = [];
  for (const e of edges) {
    const a = edgeHex(e);
    const b = edgeOther(state, e);
    const h = b >= 0 && dist(b) < dist(a) ? b : a;
    if (!hexes.includes(h)) hexes.push(h);
  }
  return { edges, hexes };
}

/** Ставит или снимает линию наступления армии с фронтом; места отрядов не трогает. */
export function setOffensive(state: MatchState, armyId: number, line: OffensiveLine | null): void {
  const i = state.plans.findIndex((p) => p.armyId === armyId);
  const plan = state.plans[i];
  if (plan?.kind === 'front') state.plans[i] = { ...plan, offensive: line };
}

function setPlan(state: MatchState, plan: ArmyPlan): void {
  removePlan(state, plan.armyId);
  state.plans.push(plan);
  state.plans.sort((a, b) => a.armyId - b.armyId);
}

/** Применяет команду плана. Вызывается только после успешной проверки. */
export function executePlanCommand(state: MatchState, playerId: number, cmd: PlanCommand): void {
  if (cmd.t === 'clearPlan') return removePlan(state, cmd.armyId);
  if (cmd.t === 'stopOffensive') return setOffensive(state, cmd.armyId, null);
  if (cmd.t === 'setOffensiveLine') {
    const plan = state.plans.find((p) => p.armyId === cmd.armyId);
    const edges = landEdgePath(state, cmd.edges);
    if (!plan || !edges) return;
    return setOffensive(state, cmd.armyId, offensiveLine(state, plan, edges));
  }
  if (cmd.t === 'assignFront') {
    const edges = frontEdgePath(state, playerId, cmd.edges);
    if (!edges) return;
    return setPlan(state, { armyId: cmd.armyId, kind: 'front', edges, offensive: null });
  }
  const hexes = defenseLinePath(state, playerId, cmd.points);
  if (hexes) setPlan(state, { armyId: cmd.armyId, kind: 'line', hexes });
}
