// Команды армий: move, setOrder, split, merge.
// GDD: docs/gdd/05-armies.md — «Движение», «Разделение и слияние», «Приказы».
import { MAX_ARMIES_PER_HEX } from '../balance.ts';
import { armyLimit } from './recruit.ts';
import { OK, rejected, type Command, type RejectReason, type Validation } from './types.ts';
import type { HexId } from '../math/hex.ts';
import { FP, intDiv, type Fp } from '../math/int.ts';
import { findPath, ownArmiesAt } from '../queries/army-path.ts';
import type { Army, MatchState } from '../state/types.ts';

export type ArmyCommand = Extract<Command, { t: 'move' | 'setOrder' | 'split' | 'merge' }>;

type Owned =
  | { readonly ok: true; readonly armies: Army[] }
  | { readonly ok: false; readonly reason: RejectReason };

// Все id различны, существуют и принадлежат игроку; порядок — как в команде.
function ownArmies(state: MatchState, playerId: number, ids: readonly number[]): Owned {
  if (ids.length === 0 || new Set(ids).size !== ids.length)
    return { ok: false, reason: 'unknownArmy' };
  const armies: Army[] = [];
  for (const id of ids) {
    const army = state.armies.find((a) => a.id === id);
    if (!army) return { ok: false, reason: 'unknownArmy' };
    if (army.owner !== playerId) return { ok: false, reason: 'notOwnArmy' };
    armies.push(army);
  }
  return { ok: true, armies };
}

function validateMove(state: MatchState, armies: readonly Army[], to: HexId): Validation {
  if (!Number.isInteger(to) || to < 0 || to >= state.hexes.owner.length) return rejected('badHex');
  for (const a of armies) {
    if (a.hex === to) continue;
    if (ownArmiesAt(state, a.owner, to) >= MAX_ARMIES_PER_HEX) return rejected('hexFull');
    if (!findPath(state, a.hex, to, a.type, a.owner)) return rejected('noPath');
  }
  return OK;
}

function validateSplit(state: MatchState, army: Army, soldiers: number): Validation {
  if (!Number.isInteger(soldiers) || soldiers % FP !== 0 || soldiers <= 0) {
    return rejected('invalidAmount');
  }
  if (soldiers >= army.soldiers) return rejected('invalidAmount');
  if (ownArmiesAt(state, army.owner, army.hex) >= MAX_ARMIES_PER_HEX) return rejected('hexFull');
  const used =
    state.armies.filter((a) => a.owner === army.owner).length +
    state.recruits.filter((r) => r.owner === army.owner).length;
  return used >= armyLimit(state, army.owner) ? rejected('armyLimit') : OK;
}

function validateMerge(armies: readonly Army[]): Validation {
  const [first] = armies;
  if (!first || armies.length < 2) return rejected('invalidAmount');
  if (armies.some((a) => a.hex !== first.hex)) return rejected('notSameHex');
  if (armies.some((a) => a.type !== first.type)) return rejected('notSameType');
  return OK;
}

/**
 * Проверяет команду армии без изменения состояния.
 * @returns OK или отказ с причиной
 */
export function validateArmyCommand(
  state: MatchState,
  playerId: number,
  cmd: ArmyCommand,
): Validation {
  const ids = cmd.t === 'split' ? [cmd.armyId] : cmd.armyIds;
  const owned = ownArmies(state, playerId, ids);
  if (!owned.ok) return rejected(owned.reason);
  switch (cmd.t) {
    case 'move':
      return validateMove(state, owned.armies, cmd.to);
    case 'setOrder':
      return OK;
    case 'split':
      return owned.armies[0]
        ? validateSplit(state, owned.armies[0], cmd.soldiers)
        : rejected('unknownArmy');
    case 'merge':
      return validateMerge(owned.armies);
  }
}

function stop(army: Army): void {
  army.path = [];
  army.moveTicks = 0;
  army.moveTotal = 0;
}

function executeSplit(state: MatchState, army: Army, soldiers: Fp): void {
  army.soldiers = (army.soldiers - soldiers) as Fp;
  // Id растут монотонно, поэтому push сохраняет сортировку армий по id.
  state.armies.push({
    id: state.nextId,
    owner: army.owner,
    type: army.type,
    soldiers,
    org: army.org,
    hex: army.hex,
    order: 'idle',
    supplyLevel: army.supplyLevel,
    path: [],
    moveTicks: 0,
    moveTotal: 0,
  });
  state.nextId += 1;
}

// Остаётся армия с наименьшим id; org — средневзвешенная по солдатам.
function executeMerge(state: MatchState, armies: readonly Army[]): void {
  const sorted = [...armies].sort((a, b) => a.id - b.id);
  const [kept, ...rest] = sorted;
  if (!kept) return;
  let soldiers = 0;
  let orgWeighted = 0;
  for (const a of sorted) {
    soldiers += a.soldiers;
    orgWeighted += a.org * a.soldiers;
  }
  kept.soldiers = soldiers as Fp;
  kept.org = intDiv(orgWeighted, soldiers) as Fp;
  kept.order = 'idle';
  stop(kept);
  const removed = new Set(rest.map((a) => a.id));
  const remaining = state.armies.filter((a) => !removed.has(a.id));
  state.armies.splice(0, state.armies.length, ...remaining);
}

/** Применяет команду армии. Вызывается только после успешной проверки. */
export function executeArmyCommand(state: MatchState, playerId: number, cmd: ArmyCommand): void {
  const ids = cmd.t === 'split' ? [cmd.armyId] : cmd.armyIds;
  const owned = ownArmies(state, playerId, ids);
  if (!owned.ok) return;
  switch (cmd.t) {
    case 'move':
      for (const a of owned.armies) {
        const path = findPath(state, a.hex, cmd.to, a.type, a.owner) ?? [];
        stop(a);
        a.path = path;
        a.order = path.length > 0 ? 'move' : 'idle';
      }
      return;
    case 'setOrder':
      for (const a of owned.armies) {
        stop(a);
        a.order = cmd.order;
      }
      return;
    case 'split':
      if (owned.armies[0]) executeSplit(state, owned.armies[0], cmd.soldiers);
      return;
    case 'merge':
      executeMerge(state, owned.armies);
      return;
  }
}
