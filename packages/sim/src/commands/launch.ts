// Направление одной командой (07-controls.md, «Меню страны»): армия «Фронт: имя» набирает отряды
// под заданное число солдат и ставит фронт на границу с целью — соседом или ничьей землёй.
// Наступление (`launchOffensive`) ещё строит линию и стартует, удержание (`holdBorder`) оставляет
// армию на фронте; дальше всё ведёт обычный движок фронта.
import { ARMY_NAME_MAX, executeArmyCommand } from './army.ts';
import { executePlanCommand, validatePlanCommand } from './plan.ts';
import { OK, rejected, type Validation } from './types.ts';
import { commanderLine } from '../bots/commander-line.ts';
import { distance, hexFromId } from '../math/hex.ts';
import { FP } from '../math/int.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { borderEdges, borderSegmentEdges, edgeHex, type EdgeId } from '../state/edges.ts';
import { atWar } from '../state/relations.ts';
import type { Army, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Предел заказа солдат в одной команде: защита от мусорных значений. */
const SOLDIERS_MAX = 1_000_000;

/** Ничья земля как цель направления. */
const NEUTRAL_TARGET = -1;

/** Аргументы направления: цель (id игрока или -1), заказ солдат и гекс клика для ничьей земли. */
export interface DirectionCommand {
  readonly target: number;
  readonly soldiers: number;
  readonly hex?: number;
}

// Куски границы игрока с целью. Игрок — все куски разом; ничья земля — лишь кусок ближе всего
// к гексу клика: вся ничья граница слишком велика для одного направления.
function frontToward(state: MatchState, playerId: number, cmd: DirectionCommand): EdgeId[] {
  const { width } = state.map;
  const pieces: EdgeId[][] = [];
  const seen = new Set<EdgeId>();
  for (const e of borderEdges(state, playerId)) {
    if (seen.has(e)) continue;
    const piece = borderSegmentEdges(state, playerId, cmd.target, e);
    for (const x of piece) seen.add(x);
    if (piece.length > 0) pieces.push(piece);
  }
  if (cmd.target !== NEUTRAL_TARGET || cmd.hex === undefined) return pieces.flat();
  const at = hexFromId(cmd.hex, width);
  const away = (piece: readonly EdgeId[]): number =>
    Math.min(...piece.map((e) => distance(at, hexFromId(edgeHex(e), width))));
  const nearest = [...pieces].sort((a, b) => away(a) - away(b))[0];
  return nearest ?? [];
}

function validateDirection(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
  needWar: boolean,
): Validation {
  if (cmd.target !== NEUTRAL_TARGET) {
    const target = state.players[cmd.target];
    if (!target || target.status !== 'alive' || cmd.target === playerId)
      return rejected('badPlayer');
    if (needWar && !atWar(state, playerId, cmd.target)) return rejected('notEnemy');
  }
  if (!Number.isInteger(cmd.soldiers) || cmd.soldiers < 1 || cmd.soldiers > SOLDIERS_MAX) {
    return rejected('invalidAmount');
  }
  if (
    cmd.hex !== undefined &&
    !(Number.isInteger(cmd.hex) && cmd.hex >= 0 && cmd.hex < state.hexes.owner.length)
  ) {
    return rejected('badHex');
  }
  return frontToward(state, playerId, cmd).length > 0 ? OK : rejected('noFront');
}

/**
 * Проверяет команду launchOffensive без изменения состояния: с игроком нужна война.
 * @returns OK или отказ с причиной
 */
export function validateLaunch(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
): Validation {
  return validateDirection(state, playerId, cmd, true);
}

/**
 * Проверяет команду holdBorder без изменения состояния: держать границу можно и в мире.
 * @returns OK или отказ с причиной
 */
export function validateHold(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
): Validation {
  return validateDirection(state, playerId, cmd, false);
}

const armyName = (state: MatchState, target: number): string =>
  `Фронт: ${target === NEUTRAL_TARGET ? 'ничья земля' : (state.players[target]?.name ?? target + 1)}`.slice(
    0,
    ARMY_NAME_MAX,
  );

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

// Армия направления: создаётся при первом запуске, затем переиспользуется; фронт стоит на границе
// с целью, отряды добраны под заказ, чего не хватает — закупит ИИ. Автокомандование выключено:
// иначе commander перестраивал бы и сбрасывал план.
function prepare(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
): { readonly army: Army; readonly edges: readonly EdgeId[] } | null {
  const name = armyName(state, cmd.target);
  let army = state.armies.find((a) => a.owner === playerId && a.name === name);
  if (!army) {
    executeArmyCommand(state, playerId, { t: 'createArmy', name });
    army = state.armies.at(-1);
  }
  if (!army) return null;
  army.auto = false;
  army.wanted = cmd.soldiers;
  const front = frontToward(state, playerId, cmd);
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
  return plan?.kind === 'front' ? { army, edges: plan.edges } : null;
}

/** Применяет команду holdBorder. Вызывается только после успешной проверки. */
export function executeHold(state: MatchState, playerId: number, cmd: DirectionCommand): void {
  prepare(state, playerId, cmd);
}

/** Применяет команду launchOffensive. Вызывается только после успешной проверки. */
export function executeLaunch(state: MatchState, playerId: number, cmd: DirectionCommand): void {
  const ready = prepare(state, playerId, cmd);
  if (!ready) return;
  const line = commanderLine(
    state.map,
    { hexes: state.hexes, cities: state.cities },
    ready.edges,
    cmd.target,
  );
  if (line.length === 0) return;
  const { army } = ready;
  executePlanCommand(state, playerId, { t: 'setOffensiveLine', armyId: army.id, edges: line });
  const start = { t: 'startOffensive', armyId: army.id } as const;
  if (validatePlanCommand(state, playerId, start).ok) executePlanCommand(state, playerId, start);
}
