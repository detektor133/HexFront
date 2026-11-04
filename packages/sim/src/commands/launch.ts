// Наступление на игрока одной командой (07-controls.md, «Меню страны»): армия «→ имя» набирает
// отряды под заданное число солдат, ставит фронт на границу с целью, строит линию наступления
// и начинает наступление; дальше всё ведёт обычный движок фронта.
import { ARMY_NAME_MAX, executeArmyCommand } from './army.ts';
import { executePlanCommand, validatePlanCommand } from './plan.ts';
import { OK, rejected, type Validation } from './types.ts';
import { commanderLine } from '../bots/commander-line.ts';
import { distance, hexFromId } from '../math/hex.ts';
import { FP } from '../math/int.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { borderEdges, borderSegmentEdges, edgeHex, type EdgeId } from '../state/edges.ts';
import { atWar } from '../state/relations.ts';
import type { MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Предел заказа солдат в одной команде: защита от мусорных значений. */
const SOLDIERS_MAX = 1_000_000;

/** Куски границы игрока с целью: все грани своей границы, за которыми земля target. */
function frontToward(state: MatchState, playerId: number, target: number): EdgeId[] {
  const out: EdgeId[] = [];
  const seen = new Set<EdgeId>();
  for (const e of borderEdges(state, playerId)) {
    if (seen.has(e)) continue;
    for (const x of borderSegmentEdges(state, playerId, target, e)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Проверяет команду launchOffensive без изменения состояния.
 * @returns OK или отказ с причиной
 */
export function validateLaunch(
  state: MatchState,
  playerId: number,
  cmd: { readonly target: number; readonly soldiers: number },
): Validation {
  const target = state.players[cmd.target];
  if (!target || target.status !== 'alive' || cmd.target === playerId) return rejected('badPlayer');
  if (!atWar(state, playerId, cmd.target)) return rejected('notEnemy');
  if (!Number.isInteger(cmd.soldiers) || cmd.soldiers < 1 || cmd.soldiers > SOLDIERS_MAX) {
    return rejected('invalidAmount');
  }
  return frontToward(state, playerId, cmd.target).length > 0 ? OK : rejected('noFront');
}

const armyName = (state: MatchState, target: number): string =>
  `→ ${state.players[target]?.name ?? target + 1}`.slice(0, ARMY_NAME_MAX);

// Свободные отряды: сначала резерв, затем стоящие отряды других армий; ближе к фронту — раньше.
function candidates(
  state: MatchState,
  playerId: number,
  armyId: number,
  front: readonly EdgeId[],
): Unit[] {
  const { width } = state.map;
  const hexes = front.map((e) => hexFromId(edgeHex(e), width));
  const away = (u: Unit): number =>
    Math.min(...hexes.map((h) => distance(hexFromId(u.hex, width), h)));
  return allUnits(state)
    .filter(
      (u) =>
        u.owner === playerId &&
        u.armyId !== armyId &&
        u.order === 'idle' &&
        !u.inBattle &&
        u.slot !== SLOT_DETACHED,
    )
    .sort(
      (a, b) =>
        Number(a.armyId !== null) - Number(b.armyId !== null) || away(a) - away(b) || a.id - b.id,
    );
}

/** Применяет команду launchOffensive. Вызывается только после успешной проверки. */
export function executeLaunch(
  state: MatchState,
  playerId: number,
  cmd: { readonly target: number; readonly soldiers: number },
): void {
  const name = armyName(state, cmd.target);
  let army = state.armies.find((a) => a.owner === playerId && a.name === name);
  if (!army) {
    executeArmyCommand(state, playerId, { t: 'createArmy', name });
    army = state.armies.at(-1);
  }
  if (!army) return;
  const front = frontToward(state, playerId, cmd.target);
  let have = allUnits(state)
    .filter((u) => u.armyId === army.id)
    .reduce((sum, u) => sum + u.soldiers, 0);
  const picked: number[] = [];
  for (const u of candidates(state, playerId, army.id, front)) {
    if (have >= cmd.soldiers * FP) break;
    picked.push(u.id);
    have += u.soldiers;
  }
  if (picked.length > 0) {
    executeArmyCommand(state, playerId, { t: 'assignUnits', unitIds: picked, armyId: army.id });
  }
  executePlanCommand(state, playerId, { t: 'assignFront', armyId: army.id, edges: front });
  const plan = state.plans.find((p) => p.armyId === army.id);
  if (plan?.kind !== 'front') return;
  const line = commanderLine(
    state.map,
    { hexes: state.hexes, cities: state.cities },
    plan.edges,
    cmd.target,
  );
  if (line.length === 0) return;
  executePlanCommand(state, playerId, { t: 'setOffensiveLine', armyId: army.id, edges: line });
  const start = { t: 'startOffensive', armyId: army.id } as const;
  if (validatePlanCommand(state, playerId, start).ok) executePlanCommand(state, playerId, start);
}
