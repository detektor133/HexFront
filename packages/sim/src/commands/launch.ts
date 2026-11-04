// Направление одной командой (07-controls.md, «Меню страны»): армия направления набирает отряды
// под заданное число солдат и ставит фронт на границу с целью — соседом или ничьей землёй.
// Наступление (`launchOffensive`) бьёт в сторону клика: участок фронта у места клика, ширина и
// глубина — от числа войск; удержание (`holdBorder`) держит всю границу с игроком, пока цель жива,
// и 0 солдат снимает направление. Дальше всё ведёт обычный движок фронта.
import { ARMY_NAME_MAX, executeArmyCommand } from './army.ts';
import { executePlanCommand, removePlan, validatePlanCommand } from './plan.ts';
import { OK, rejected, type Validation } from './types.ts';
import { commanderLine } from '../bots/commander-line.ts';
import { distance, hexFromId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { borderEdges, borderSegmentEdges, edgeHex, type EdgeId } from '../state/edges.ts';
import { atWar } from '../state/relations.ts';
import type { Army, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Предел заказа солдат в одной команде: защита от мусорных значений. */
const SOLDIERS_MAX = 1_000_000;

/** Ничья земля как цель направления. */
export const NEUTRAL_TARGET = -1;

/** Сколько солдат приходится на одну грань участка удара: больше войск — шире удар. */
const SOLDIERS_PER_EDGE = 100;
const WINDOW_MIN = 2;
const WINDOW_MAX = 12;
/** Предел глубины линии наступления от клика, гексов. */
const DEPTH_MAX = 8;

/** Аргументы направления: цель (id игрока или -1), заказ солдат и гекс клика. */
export interface DirectionCommand {
  readonly target: number;
  readonly soldiers: number;
  readonly hex?: number;
}

/** Куски своей границы с целью, каждый — упорядоченная цепочка граней. */
export function borderPieces(state: MatchState, playerId: number, target: number): EdgeId[][] {
  const pieces: EdgeId[][] = [];
  const seen = new Set<EdgeId>();
  for (const e of borderEdges(state, playerId)) {
    if (seen.has(e)) continue;
    const piece = borderSegmentEdges(state, playerId, target, e);
    for (const x of piece) seen.add(x);
    if (piece.length > 0) pieces.push(piece);
  }
  return pieces;
}

// Участок удара: цепочка границы у гекса клика, шириной по числу войск, и расстояние от него до
// клика — глубина линии наступления.
function strikeFront(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
): { readonly edges: EdgeId[]; readonly depth: number } {
  const pieces = borderPieces(state, playerId, cmd.target);
  if (cmd.hex === undefined) return { edges: pieces.flat(), depth: 0 };
  const { width } = state.map;
  const at = hexFromId(cmd.hex, width);
  let piece: EdgeId[] = [];
  let index = 0;
  let gap = Number.MAX_SAFE_INTEGER;
  for (const candidate of pieces) {
    for (let i = 0; i < candidate.length; i += 1) {
      const d = distance(at, hexFromId(edgeHex(candidate[i] as EdgeId), width));
      if (d < gap) {
        piece = candidate;
        index = i;
        gap = d;
      }
    }
  }
  if (piece.length === 0) return { edges: [], depth: 0 };
  const half = Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, intDiv(cmd.soldiers, SOLDIERS_PER_EDGE)));
  return {
    edges: piece.slice(Math.max(0, index - half), index + half + 1),
    depth: Math.min(DEPTH_MAX, Math.max(1, gap)),
  };
}

function validateDirection(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
  opts: { readonly needWar: boolean; readonly minSoldiers: number },
): Validation {
  if (cmd.target !== NEUTRAL_TARGET) {
    const target = state.players[cmd.target];
    if (!target || target.status !== 'alive' || cmd.target === playerId)
      return rejected('badPlayer');
    if (opts.needWar && !atWar(state, playerId, cmd.target)) return rejected('notEnemy');
  }
  if (
    !Number.isInteger(cmd.soldiers) ||
    cmd.soldiers < opts.minSoldiers ||
    cmd.soldiers > SOLDIERS_MAX
  ) {
    return rejected('invalidAmount');
  }
  const badHex =
    cmd.hex !== undefined &&
    !(Number.isInteger(cmd.hex) && cmd.hex >= 0 && cmd.hex < state.hexes.owner.length);
  if (badHex) return rejected('badHex');
  // Снять направление можно и без границы; остальное требует контакта с целью.
  if (cmd.soldiers === 0) return OK;
  const contact = strikeFront(state, playerId, { target: cmd.target, soldiers: cmd.soldiers });
  return contact.edges.length > 0 ? OK : rejected('noFront');
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
  return validateDirection(state, playerId, cmd, { needWar: true, minSoldiers: 1 });
}

/**
 * Проверяет команду holdBorder без изменения состояния: держать границу можно и в мире; 0 снимает
 * направление.
 * @returns OK или отказ с причиной
 */
export function validateHold(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
): Validation {
  return validateDirection(state, playerId, cmd, { needWar: false, minSoldiers: 0 });
}

const armyName = (state: MatchState, target: number): string =>
  (target === NEUTRAL_TARGET
    ? 'Ничья земля'
    : (state.players[target]?.name ?? `${target + 1}`)
  ).slice(0, ARMY_NAME_MAX);

/** Армия направления игрока на цель: ищется по цели, а не по имени — имя игрок может поменять. */
export function directionArmy(
  state: MatchState,
  playerId: number,
  target: number,
): Army | undefined {
  return state.armies.find((a) => a.owner === playerId && a.dir?.target === target);
}

// Свободные отряды: сначала резерв, затем стоящие отряды армий без плана и без заказа; ближе к
// фронту — раньше. Отряды армий на фронте не трогаем: их границу никто больше не прикроет.
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
  const spare = (u: Unit): boolean => {
    if (u.armyId === null) return true;
    const owner = state.armies.find((a) => a.id === u.armyId);
    return (
      owner !== undefined &&
      owner.wanted === undefined &&
      !state.plans.some((p) => p.armyId === u.armyId)
    );
  };
  return allUnits(state)
    .filter(
      (u) =>
        u.owner === playerId &&
        u.armyId !== armyId &&
        u.order === 'idle' &&
        !u.inBattle &&
        u.slot !== SLOT_DETACHED &&
        spare(u),
    )
    .sort(
      (a, b) =>
        Number(a.armyId !== null) - Number(b.armyId !== null) || away(a) - away(b) || a.id - b.id,
    );
}

/** Снимает направление: фронт и заказ убираются, отряды уходят в резерв, армия расформировывается. */
export function releaseDirection(state: MatchState, army: Army): void {
  removePlan(state, army.id);
  for (const u of allUnits(state)) {
    if (u.armyId === army.id) {
      u.armyId = null;
      u.slot = -1;
    }
  }
  const rest = state.recruits.filter((r) => r.armyId !== army.id);
  state.recruits.splice(0, state.recruits.length, ...rest);
  const armies = state.armies.filter((a) => a.id !== army.id);
  state.armies.splice(0, state.armies.length, ...armies);
}

// Армия направления: создаётся при первом запуске, затем переиспользуется; фронт стоит на границе
// с целью, отряды добраны под заказ, чего не хватает — закупит ИИ. Автокомандование выключено:
// иначе commander перестраивал бы и сбрасывал план.
function prepare(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
  mode: 'hold' | 'attack',
): { readonly army: Army; readonly edges: readonly EdgeId[]; readonly depth: number } | null {
  let army = directionArmy(state, playerId, cmd.target);
  if (!army) {
    executeArmyCommand(state, playerId, { t: 'createArmy', name: armyName(state, cmd.target) });
    army = state.armies.at(-1);
  }
  if (!army) return null;
  army.auto = false;
  army.wanted = cmd.soldiers;
  army.dir = { target: cmd.target, mode };
  // Удержание берёт всю границу с игроком; удар и ничья земля — участок у клика.
  const aim: DirectionCommand =
    mode === 'hold' && cmd.target >= 0 ? { target: cmd.target, soldiers: cmd.soldiers } : cmd;
  const strike = strikeFront(state, playerId, aim);
  const front = strike.edges;
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
  return plan?.kind === 'front' ? { army, edges: plan.edges, depth: strike.depth } : null;
}

/** Применяет команду holdBorder. Вызывается только после успешной проверки. */
export function executeHold(state: MatchState, playerId: number, cmd: DirectionCommand): void {
  if (cmd.soldiers === 0) {
    const army = directionArmy(state, playerId, cmd.target);
    if (army) releaseDirection(state, army);
    return;
  }
  prepare(state, playerId, cmd, 'hold');
}

/** Применяет команду launchOffensive. Вызывается только после успешной проверки. */
export function executeLaunch(state: MatchState, playerId: number, cmd: DirectionCommand): void {
  const ready = prepare(state, playerId, cmd, 'attack');
  if (!ready) return;
  const line = commanderLine(
    state.map,
    { hexes: state.hexes, cities: state.cities },
    ready.edges,
    cmd.target,
    ready.depth > 0 ? ready.depth : undefined,
  );
  if (line.length === 0) return;
  const { army } = ready;
  executePlanCommand(state, playerId, { t: 'setOffensiveLine', armyId: army.id, edges: line });
  const start = { t: 'startOffensive', armyId: army.id } as const;
  if (validatePlanCommand(state, playerId, start).ok) executePlanCommand(state, playerId, start);
}
