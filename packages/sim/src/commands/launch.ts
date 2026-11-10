// Направление одной командой (07-controls.md, «Меню страны»): армия направления набирает отряды
// под заданное число солдат и ставит фронт на границу с целью (соседом, его союзниками при войне
// с ними, или ничьей землёй). Наступление (`launchOffensive`): ось удара выбирает сам ИИ по
// обстановке (`pickAxis`), клик задаёт только цель; удержание (`holdBorder`) держит всю границу
// с целью, пока она жива, и 0 солдат снимает направление. Дальше всё ведёт обычный движок фронта.
import { dropEmptyArmies, executeArmyCommand, validMix } from './army.ts';
import { pickAxes, type Force, type Strike } from './axis.ts';
import { executePlanCommand, placeFront, removePlan, validatePlanCommand } from './plan.ts';
import { releaseDirection } from './release.ts';
import { OK, rejected, type Validation } from './types.ts';
import { AXIS_DONE_PERCENT, AXIS_MAX, AXIS_SOLDIERS, OFFENSIVE_RETRY_TICKS } from '../balance.ts';
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
import { mixNeed } from '../state/mix.ts';
import { atWar, isAllied } from '../state/relations.ts';
import type { Army, ArmyMix, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';
import { expandNeutral } from '../systems/expand.ts';
import { lineRuns } from '../systems/offensive.ts';

/** Предел заказа солдат в одной команде: защита от мусорных значений. */
const SOLDIERS_MAX = 1_000_000;

/** `armyId` направления: всегда создать новую армию, а не взять армию направления на цель. */
export const NEW_ARMY = -1;

/** Ничья земля как цель направления. */
export const NEUTRAL_TARGET = -1;

/** Аргументы направления: цель (id игрока или -1), заказ солдат и гекс клика. */
export interface DirectionCommand {
  readonly target: number;
  readonly soldiers: number;
  readonly hex?: number;
  /** Откуда брать солдат: id своих армий, −1 — резерв; нет поля — ИИ берёт свободных сам. */
  readonly from?: readonly number[];
  /** Армия, которой отдан приказ; нет поля — армия направления на цель или новая. */
  readonly armyId?: number;
  /** Состав заказа по типам; нет поля — любой. */
  readonly mix?: ArmyMix;
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
  army?: Army,
): Strike {
  return pickAxes(
    state,
    playerId,
    blocOf(state, playerId, cmd.target),
    borderPieces(state, playerId, cmd.target),
    cmd.soldiers,
    skip,
    want,
    forcesOf(state, playerId, army),
  );
}

// Войска, которыми будет бить направление: отряды армии, а пока их нет (первый приказ) — свободные
// и стоящие отряды игрока. Оси выбираются рядом с ними (axis.ts, TRAVEL_COST).
function forcesOf(state: MatchState, playerId: number, army?: Army): Force[] {
  const own = allUnits(state).filter(
    (u) => u.owner === playerId && u.type !== 'artillery' && u.order !== 'retreat' && !u.sea,
  );
  const mine = army === undefined ? [] : own.filter((u) => u.armyId === army.id);
  const pool = mine.length > 0 ? mine : own;
  const byHex = new Map<HexId, number>();
  for (const u of pool) byHex.set(u.hex, (byHex.get(u.hex) ?? 0) + intDiv(u.soldiers, FP));
  return [...byHex].sort((a, b) => a[0] - b[0]).map(([hex, soldiers]) => ({ hex, soldiers }));
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
  if (cmd.armyId !== undefined && cmd.armyId !== NEW_ARMY) {
    const army = state.armies.find((a) => a.id === cmd.armyId);
    if (!army) return rejected('unknownArmy');
    if (army.owner !== playerId) return rejected('notOwnArmy');
  }
  if (!validMix(cmd.mix, cmd.soldiers)) return rejected('badValue');
  if (cmd.from !== undefined) {
    const own = new Set(state.armies.filter((a) => a.owner === playerId).map((a) => a.id));
    const ok = Array.isArray(cmd.from) && cmd.from.every((id) => id === -1 || own.has(id));
    if (!ok) return rejected('unknownArmy');
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

/** Армия направления игрока на цель: ищется по цели, а не по имени — имя игрок может поменять. */
export function directionArmy(
  state: MatchState,
  playerId: number,
  target: number,
): Army | undefined {
  // Снятое направление остаётся у армии как idle: действующая армия на цель важнее такой тени,
  // иначе «снять с фронта» и повторный приказ доставались бы не той армии.
  const mine = state.armies.filter((a) => a.owner === playerId && a.dir?.target === target);
  return mine.find((a) => a.dir?.mode !== 'idle') ?? mine[0];
}

// Свободные отряды: сначала резерв, затем стоящие отряды армий без плана и без заказа; ближе к
// фронту — раньше. Отряды армий на фронте не трогаем: их границу никто больше не прикроет.
function candidates(
  state: MatchState,
  playerId: number,
  armyId: number,
  anchors: readonly HexId[],
  from?: readonly number[],
): Unit[] {
  const { width } = state.map;
  const hexes = anchors.map((h) => hexFromId(h, width));
  const away = (u: Unit): number =>
    Math.min(...hexes.map((h) => distance(hexFromId(u.hex, width), h)));
  const spare = (u: Unit): boolean => {
    // Источники выбрал игрок: берём из них любые стоящие отряды, а не только свободные.
    if (from !== undefined) return from.includes(u.armyId ?? -1);
    if (u.armyId === null) return true;
    const owner = state.armies.find((a) => a.id === u.armyId);
    // Армия без дела — без заказа или с законченным направлением (`idle`) — отдаёт стоящие отряды.
    return (
      owner !== undefined &&
      (owner.wanted === undefined || owner.dir?.mode === 'idle') &&
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
  let army =
    cmd.armyId === undefined
      ? directionArmy(state, playerId, cmd.target)
      : cmd.armyId === NEW_ARMY
        ? undefined
        : state.armies.find((a) => a.id === cmd.armyId);
  // Единственная армия без дела — стартовая «Армия 1»: приказ достаётся ей, а не новой армии,
  // иначе новая забирала бы все отряды, а стартовая исчезала и первой армией игрока становилась «Армия 2».
  if (!army) {
    const own = state.armies.filter((a) => a.owner === playerId);
    const [only] = own;
    if (
      own.length === 1 &&
      only !== undefined &&
      only.dir === undefined &&
      only.wanted === undefined &&
      !state.plans.some((p) => p.armyId === only.id)
    ) {
      army = only;
    }
  }
  if (!army) {
    executeArmyCommand(state, playerId, { t: 'createArmy', name: '' });
    army = state.armies.at(-1);
  }
  if (!army) return null;
  army.auto = false;
  army.wanted = cmd.soldiers;
  army.trim = true;
  if (cmd.mix === undefined) delete army.mix;
  else army.mix = cmd.mix;
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
    : strikeFront(state, playerId, cmd, [], undefined, army);
  const anchors =
    neutral && cmd.hex !== undefined
      ? [cmd.hex]
      : (neutral ? borderPieces(state, playerId, cmd.target).flat() : front).map((e) => edgeHex(e));
  const need = mixNeed(cmd.soldiers, cmd.mix);
  const haveBy = { infantry: 0, armor: 0, artillery: 0 };
  let have = 0;
  for (const u of allUnits(state)) {
    if (u.armyId !== army.id) continue;
    haveBy[u.type] += u.soldiers;
    have += u.soldiers;
  }
  const picked: number[] = [];
  for (const u of candidates(state, playerId, army.id, anchors, cmd.from)) {
    if (have >= cmd.soldiers * FP) break;
    // Состав задан: берём только тот тип, которого армии ещё не хватает.
    if (need !== undefined && haveBy[u.type] >= need[u.type] * FP) continue;
    picked.push(u.id);
    haveBy[u.type] += u.soldiers;
    have += u.soldiers;
  }
  if (picked.length > 0) {
    // Откуда забрали отряды: опустевшая безымянная армия (стартовая «1-я») больше не нужна.
    const sources = new Set<number>();
    for (const u of allUnits(state)) {
      if (picked.includes(u.id) && u.armyId !== null) sources.add(u.armyId);
    }
    const taken = new Map<number, number>();
    for (const u of allUnits(state)) {
      if (picked.includes(u.id) && u.armyId !== null) {
        taken.set(u.armyId, (taken.get(u.armyId) ?? 0) + u.soldiers);
      }
    }
    executeArmyCommand(state, playerId, { t: 'assignUnits', unitIds: picked, armyId: army.id });
    // Донор с направлением не добирает забранное: его лимит уменьшается на отданных солдат.
    for (const [id, soldiers] of taken) {
      const donor = state.armies.find((a) => a.id === id);
      if (donor?.wanted !== undefined) {
        donor.wanted = Math.max(0, donor.wanted - intDiv(soldiers, FP));
      }
    }
    dropEmptyArmies(state, sources);
  }
  // Занятие ничьей земли ведёт `expandNeutral` без плана: фронта у такой армии нет.
  if (neutral) {
    removePlan(state, army.id);
    return { army, strike };
  }
  if (front.length === 0) return null;
  placeFront(state, army.id, front, cmd.target);
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
  const strike = strikeFront(
    state,
    army.owner,
    cmd,
    kept.flat(),
    strikeAxes(army) - kept.length,
    army,
  );
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
  const strike = strikeFront(
    state,
    army.owner,
    { target: dir.target, soldiers: army.wanted ?? 1 },
    [],
    undefined,
    army,
  );
  if (strike.edges.length > 0 && startStrike(state, army, dir.target, strike)) return;
  // Бить пока нечем: временная оборона, через OFFENSIVE_RETRY_TICKS армия попробует снова.
  army.dir = { target: dir.target, mode: 'hold', resume: state.tick + OFFENSIVE_RETRY_TICKS };
}

/**
 * Наступление встало (нет шага и боя OFFENSIVE_STALL_TICKS): командир отменяет стоящие оси и ищет
 * новые на другом участке; если ударить некуда — армия уходит во временную оборону и вернётся к
 * наступлению позже, а не стоит без дела.
 */
export function reshuffleStrike(state: MatchState, army: Army): void {
  const dir = army.dir;
  const plan = state.plans.find((p) => p.armyId === army.id);
  if (!dir || dir.mode !== 'attack' || plan?.kind !== 'front' || !plan.offensive) return;
  const stalled = plan.offensive.edges;
  const cmd = { target: dir.target, soldiers: army.wanted ?? 1 };
  const strike = strikeFront(state, army.owner, cmd, stalled, strikeAxes(army), army);
  const fresh = strikeLines(state, army, dir.target, strike);
  if (fresh.length > 0) {
    setLines(state, army, fresh);
    const start = { t: 'startOffensive', armyId: army.id } as const;
    if (validatePlanCommand(state, army.owner, start).ok) {
      executePlanCommand(state, army.owner, start);
    }
    return;
  }
  executePlanCommand(state, army.owner, { t: 'clearOffensive', armyId: army.id });
  army.dir = { target: dir.target, mode: 'hold', resume: state.tick + OFFENSIVE_RETRY_TICKS };
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
