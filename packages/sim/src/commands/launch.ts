// Направление одной командой (07-controls.md, «Меню страны»): армия направления набирает отряды
// под заданное число солдат и ставит фронт на границу с целью (соседом, его союзниками при войне
// с ними, или ничьей землёй). Наступление (`launchOffensive`): ось удара выбирает сам ИИ по
// обстановке (`pickAxis`), клик задаёт только цель; удержание (`holdBorder`) держит всю границу
// с целью, пока она жива, и 0 солдат снимает направление. Дальше всё ведёт обычный движок фронта.
import { ARMY_NAME_MAX, executeArmyCommand } from './army.ts';
import { pickAxes, type Strike } from './axis.ts';
import { executePlanCommand, placeFront, removePlan, validatePlanCommand } from './plan.ts';
import { releaseDirection } from './release.ts';
import { OK, rejected, type Validation } from './types.ts';
import { AXIS_DONE_PERCENT, AXIS_MAX, AXIS_SOLDIERS } from '../balance.ts';
import { commanderLine } from '../bots/commander-line.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import {
  borderEdges,
  borderSegmentEdges,
  edgeHex,
  edgeOther,
  type EdgeId,
} from '../state/edges.ts';
import { atWar, isAllied } from '../state/relations.ts';
import type { Army, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';
import { expandNeutral } from '../systems/expand.ts';
import { lineRuns } from '../systems/offensive.ts';

/** Предел заказа солдат в одной команде: защита от мусорных значений. */
const SOLDIERS_MAX = 1_000_000;

/** Ничья земля как цель направления. */
export const NEUTRAL_TARGET = -1;

/** Аргументы направления: цель (id игрока или -1), заказ солдат и гекс клика. */
export interface DirectionCommand {
  readonly target: number;
  readonly soldiers: number;
  readonly hex?: number;
}

/**
 * Блок цели: она сама и её союзники, с которыми мы воюем, — для ИИ это общее полотно врагов.
 * Ничья земля — отдельная цель без союзников.
 * @returns признак «гекс этого владельца — враг направления»
 */
export function blocOf(
  state: MatchState,
  playerId: number,
  target: number,
): (who: number) => boolean {
  if (target === NEUTRAL_TARGET) return (who) => who === NEUTRAL_TARGET;
  const bloc = new Set<number>([target]);
  for (const p of state.players) {
    if (p.id !== playerId && isAllied(state, target, p.id) && atWar(state, playerId, p.id)) {
      bloc.add(p.id);
    }
  }
  return (who) => bloc.has(who);
}

/** Куски своей границы с блоком цели, каждый — упорядоченная цепочка граней. */
export function borderPieces(state: MatchState, playerId: number, target: number): EdgeId[][] {
  const isEnemy = blocOf(state, playerId, target);
  const pieces: EdgeId[][] = [];
  const seen = new Set<EdgeId>();
  for (const e of borderEdges(state, playerId)) {
    if (seen.has(e)) continue;
    const piece = borderSegmentEdges(state, playerId, isEnemy, e);
    for (const x of piece) seen.add(x);
    if (piece.length > 0) pieces.push(piece);
  }
  return pieces;
}

// Участок удара выбирает ИИ: клик игрока в выборе оси не участвует.
function strikeFront(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
  skip: readonly EdgeId[] = [],
  want?: number,
): Strike {
  return pickAxes(
    state,
    playerId,
    blocOf(state, playerId, cmd.target),
    borderPieces(state, playerId, cmd.target),
    cmd.soldiers,
    skip,
    want,
  );
}

// Фронт направления: у игрока — вся граница с блоком цели (нигде нет дыр и ничего лишнего).
function frontOf(state: MatchState, playerId: number, target: number): EdgeId[] {
  return borderPieces(state, playerId, target).flat();
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
  return borderPieces(state, playerId, cmd.target).length > 0 ? OK : rejected('noFront');
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
  anchors: readonly HexId[],
): Unit[] {
  const { width } = state.map;
  const hexes = anchors.map((h) => hexFromId(h, width));
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

export { releaseDirection };

// Армия направления: создаётся при первом запуске, затем переиспользуется; фронт стоит на границе
// с целью, отряды добраны под заказ, чего не хватает — закупит ИИ. Автокомандование выключено:
// иначе commander перестраивал бы и сбрасывал план.
function prepare(
  state: MatchState,
  playerId: number,
  cmd: DirectionCommand,
  mode: 'hold' | 'attack',
): { readonly army: Army; readonly strike: Strike } | null {
  let army = directionArmy(state, playerId, cmd.target);
  if (!army) {
    executeArmyCommand(state, playerId, { t: 'createArmy', name: armyName(state, cmd.target) });
    army = state.armies.at(-1);
  }
  if (!army) return null;
  army.auto = false;
  army.wanted = cmd.soldiers;
  army.dir = {
    target: cmd.target,
    mode,
    // Клик нужен только занятию ничьей земли — как приоритет; ось удара по игроку выбирает ИИ.
    ...(mode === 'attack' && cmd.target === NEUTRAL_TARGET && cmd.hex !== undefined
      ? { hex: cmd.hex }
      : {}),
  };
  // Фронт — вся граница с блоком цели, чтобы нигде на ней не было дыр и не было лишнего.
  const neutral = cmd.target === NEUTRAL_TARGET;
  const front = neutral ? [] : frontOf(state, playerId, cmd.target);
  const strike: Strike = neutral
    ? { edges: [], windows: [], axes: 0, depth: 0 }
    : strikeFront(state, playerId, cmd);
  const anchors =
    neutral && cmd.hex !== undefined
      ? [cmd.hex]
      : (neutral ? borderPieces(state, playerId, cmd.target).flat() : front).map((e) => edgeHex(e));
  let have = allUnits(state)
    .filter((u) => u.armyId === army.id)
    .reduce((sum, u) => sum + u.soldiers, 0);
  const picked: number[] = [];
  for (const u of candidates(state, playerId, army.id, anchors)) {
    if (have >= cmd.soldiers * FP) break;
    picked.push(u.id);
    have += u.soldiers;
  }
  if (picked.length > 0) {
    executeArmyCommand(state, playerId, { t: 'assignUnits', unitIds: picked, armyId: army.id });
  }
  // Занятие ничьей земли ведёт `expandNeutral` без плана: фронта у такой армии нет.
  if (neutral) {
    removePlan(state, army.id);
    return { army, strike };
  }
  if (front.length === 0) return null;
  placeFront(state, army.id, front);
  const plan = state.plans.find((p) => p.armyId === army.id);
  return plan?.kind === 'front' ? { army, strike } : null;
}

// Линии наступления: у каждой оси свой участок границы и своя линия впереди него.
function strikeLines(state: MatchState, army: Army, target: number, strike: Strike): EdgeId[][] {
  const enemy = blocOf(state, army.owner, target);
  return strike.windows
    .map((w) =>
      commanderLine(
        state.map,
        { hexes: state.hexes, cities: state.cities },
        w,
        enemy,
        strike.depth,
      ),
    )
    .filter((line) => line.length > 0);
}

function setLines(state: MatchState, army: Army, lines: readonly (readonly EdgeId[])[]): void {
  executePlanCommand(state, army.owner, {
    t: 'setOffensiveLine',
    armyId: army.id,
    edges: lines.flat(),
    lines,
  });
}

// Линия наступления по оси удара на глубину strike.depth и старт; false — строить нечего.
function startStrike(state: MatchState, army: Army, target: number, strike: Strike): boolean {
  const lines = strikeLines(state, army, target, strike);
  if (lines.length === 0) return false;
  setLines(state, army, lines);
  const start = { t: 'startOffensive', armyId: army.id } as const;
  if (validatePlanCommand(state, army.owner, start).ok) {
    executePlanCommand(state, army.owner, start);
  }
  return true;
}

/** Доля взятых гексов линии, процентов: гексы линии — те, что у граней и входят в `hexes`. */
function takenShare(
  state: MatchState,
  owner: number,
  run: readonly EdgeId[],
  hexes: ReadonlySet<number>,
): number {
  const own = new Set<number>();
  const all = new Set<number>();
  for (const e of run) {
    for (const h of [edgeHex(e), edgeOther(state, e)]) {
      if (h < 0 || !hexes.has(h)) continue;
      all.add(h);
      if (state.hexes.owner[h] === owner) own.add(h);
    }
  }
  return all.size === 0 ? 100 : intDiv(own.size * 100, all.size);
}

/**
 * ИИ обновляет линии идущего наступления: выполненные (взято AXIS_DONE_PERCENT гексов) снимаются,
 * вместо них строятся новые оси по свежей обстановке; невыполненные остаются. Число осей держится
 * по заказу солдат.
 */
export function refreshStrike(state: MatchState, army: Army): void {
  const dir = army.dir;
  const plan = state.plans.find((p) => p.armyId === army.id);
  if (!dir || dir.mode !== 'attack' || plan?.kind !== 'front' || !plan.offensive?.active) return;
  const off = plan.offensive;
  const hexes = new Set(off.hexes);
  const runs = lineRuns(state, off.edges);
  const kept = runs.filter((r) => takenShare(state, army.owner, r, hexes) < AXIS_DONE_PERCENT);
  if (kept.length === runs.length && kept.length >= strikeAxes(army)) return;
  const cmd = { target: dir.target, soldiers: army.wanted ?? 1 };
  const strike = strikeFront(state, army.owner, cmd, kept.flat(), strikeAxes(army) - kept.length);
  const fresh = strikeLines(state, army, dir.target, strike);
  const lines = [...kept, ...fresh];
  if (lines.length === 0 || (fresh.length === 0 && kept.length === runs.length)) return;
  setLines(state, army, lines);
  const start = { t: 'startOffensive', armyId: army.id } as const;
  if (validatePlanCommand(state, army.owner, start).ok)
    executePlanCommand(state, army.owner, start);
}

const strikeAxes = (army: Army): number =>
  Math.min(AXIS_MAX, Math.max(1, intDiv(army.wanted ?? 0, AXIS_SOLDIERS)));

/**
 * Продолжает наступление направления: когда очередной удар кончился, ИИ заново оценивает
 * обстановку, выбирает ось от нового фронта и бьёт снова. Строить нечего — направление
 * переходит в «держать».
 */
export function continueStrike(state: MatchState, army: Army): void {
  const dir = army.dir;
  if (!dir || dir.mode !== 'attack') return;
  const strike = strikeFront(state, army.owner, { target: dir.target, soldiers: army.wanted ?? 1 });
  if (strike.edges.length > 0 && startStrike(state, army, dir.target, strike)) return;
  army.dir = { target: dir.target, mode: 'hold' };
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
  // Ничья земля занимается отрядами без линии наступления; игрок — наступлением по линии.
  if (cmd.target === NEUTRAL_TARGET) expandNeutral(state, ready.army);
  else startStrike(state, ready.army, cmd.target, ready.strike);
}
