// Штурм городов и добор резерва направлением (07-controls.md, «Меню страны»). Командир направления
// не оставляет по одному отряду у города, который им не взять: на вражеский город идёт минимальная
// группа, которой прогноз боя обещает победу, а свободный резерв игрока вливается в наступающую
// армию, а не стоит в тылу. Только армии с направлением `attack`; людям автоматика не включается.
import {
  ASSAULT_MAX_UNITS,
  ASSAULT_REACH,
  OFFENSIVE_STOP_ORG,
  TICKS_PER_S,
  ASSAULT_PERIOD_S,
} from '../balance.ts';
import { blocOf } from '../commands/launch.ts';
import { executeUnitCommand, validateUnitCommand } from '../commands/unit.ts';
import { distance, hexFromId } from '../math/hex.ts';
import { forecastInState } from '../queries/forecast.ts';
import { isHostileHex } from '../queries/unit-path.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import { adjacentHexes, holeComponents } from '../state/offensive-steps.ts';
import type { Army, MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

/** Столица ценнее обычного города: её потеря переносит столицу и бьёт по экономике. */
const CAPITAL_VALUE_MULT = 2;

const ready = (u: Unit): boolean =>
  u.order === 'idle' && !u.inBattle && u.type !== 'artillery' && u.org >= OFFENSIVE_STOP_ORG;

/**
 * Группы штурма: по каждому вражескому городу блока цели (по пользе: ценность / расстояние)
 * ближайшие готовые отряды армии, минимальный набор которых по прогнозу побеждает.
 */
function assault(state: MatchState, army: Army): void {
  const dir = army.dir;
  if (!dir || dir.mode !== 'attack' || dir.target < 0) return;
  const enemy = blocOf(state, army.owner, dir.target);
  const { width } = state.map;
  const at = (hex: number) => hexFromId(hex, width);
  const mine = allUnits(state).filter((u) => u.armyId === army.id);
  const busy = new Set(
    mine
      .filter((u) => u.order === 'attack' || u.path.length > 0)
      .map((u) => (u.order === 'attack' ? u.target : (u.path.at(-1) ?? -1))),
  );
  const free = mine.filter(ready);
  const used = new Set<number>();
  const ranked = state.cities
    .filter((c) => enemy(c.owner) && !busy.has(c.hex))
    .map((c) => ({
      city: c,
      value: c.level * (c.id === state.players[c.owner]?.capitalCityId ? CAPITAL_VALUE_MULT : 1),
      near: Math.min(...free.map((u) => distance(at(u.hex), at(c.hex))), Number.MAX_SAFE_INTEGER),
    }))
    .filter((t) => t.near <= ASSAULT_REACH)
    .sort((a, b) => b.value * (a.near + 1) - a.value * (b.near + 1) || a.city.hex - b.city.hex);
  for (const target of ranked) {
    const pool = free
      .filter((u) => !used.has(u.id))
      .sort(
        (a, b) =>
          distance(at(a.hex), at(target.city.hex)) - distance(at(b.hex), at(target.city.hex)) ||
          a.id - b.id,
      );
    const force: Unit[] = [];
    for (const unit of pool.slice(0, ASSAULT_MAX_UNITS)) {
      force.push(unit);
      if (forecastInState(state, force, target.city.hex).outcome !== 'victory') continue;
      const cmd = {
        t: 'attack',
        unitIds: force.map((u) => u.id),
        target: target.city.hex,
      } as const;
      if (validateUnitCommand(state, army.owner, cmd).ok) {
        executeUnitCommand(state, army.owner, cmd);
        for (const u of force) used.add(u.id);
      }
      break;
    }
  }
}

/** Самый большой котёл (проходимых гексов), который закрывают отдельно от линии наступления. */
const POCKET_MAX_LAND = 60;
/** Сколько гексов котла ставится в работу за одно решение. */
const POCKET_BATCH = 8;

/**
 * Закрытие котлов: чужие и ничьи куски внутри своей земли берутся независимо от линии наступления.
 * Заходят гексы котла, прилегающие к своей земле: пустой гекс — одним отрядом, гекс с врагом —
 * минимальной группой, которой прогноз боя обещает победу. Котёл съедается слоями, как анклав.
 */
function closePockets(state: MatchState, owner: number, armies: readonly Army[]): void {
  const ids = new Set(armies.map((a) => a.id));
  const free = allUnits(state).filter(
    (u) => u.owner === owner && u.armyId !== null && ids.has(u.armyId) && ready(u),
  );
  if (free.length === 0) return;
  const { width } = state.map;
  const at = (hex: number) => hexFromId(hex, width);
  const heading = new Set(
    allUnits(state)
      .filter((u) => u.owner === owner)
      .map((u) => (u.order === 'attack' ? u.target : (u.path.at(-1) ?? -1))),
  );
  const own = (h: number): boolean => state.hexes.owner[h] === owner;
  const targets: number[] = [];
  for (const hole of holeComponents(state, owner, POCKET_MAX_LAND)) {
    for (const h of hole) {
      if (heading.has(h)) continue;
      const touches = adjacentHexes(state, h).some(own);
      if (touches) targets.push(h);
    }
  }
  const used = new Set<number>();
  for (const hex of targets.slice(0, POCKET_BATCH)) {
    const pool = free
      .filter((u) => !used.has(u.id))
      .sort((a, b) => distance(at(a.hex), at(hex)) - distance(at(b.hex), at(hex)) || a.id - b.id);
    const hostile = isHostileHex(state, owner, hex);
    const force: Unit[] = [];
    for (const unit of pool.slice(0, hostile ? ASSAULT_MAX_UNITS : 1)) {
      force.push(unit);
      if (hostile && forecastInState(state, force, hex).outcome !== 'victory') continue;
      const cmd = hostile
        ? ({ t: 'attack', unitIds: force.map((u) => u.id), target: hex } as const)
        : ({ t: 'move', unitIds: [unit.id], to: hex } as const);
      if (validateUnitCommand(state, owner, cmd).ok) {
        executeUnitCommand(state, owner, cmd);
        for (const u of force) used.add(u.id);
      }
      break;
    }
  }
}

// Свободный резерв игрока вливается в ближайшую к нему наступающую армию: заказ — минимум,
// а отряды в тылу без дела — потеря силы.
function deployReserve(state: MatchState, owner: number, attackers: readonly Army[]): void {
  const { width } = state.map;
  const targets = attackers.map((a) => {
    const plan = state.plans.find((p) => p.armyId === a.id);
    return { army: a, hexes: plan ? planHexes(state, plan) : [] };
  });
  for (const u of allUnits(state)) {
    if (u.owner !== owner || u.armyId !== null || u.type === 'artillery') continue;
    if (u.order !== 'idle' || u.inBattle || u.slot === SLOT_DETACHED) continue;
    let best: { readonly id: number; readonly gap: number } | null = null;
    for (const t of targets) {
      if (t.hexes.length === 0) continue;
      const gap = Math.min(
        ...t.hexes.map((h) => distance(hexFromId(u.hex, width), hexFromId(h, width))),
      );
      if (!best || gap < best.gap || (gap === best.gap && t.army.id < best.id)) {
        best = { id: t.army.id, gap };
      }
    }
    if (best) u.armyId = best.id;
  }
}

/** Штурм городов и вливание резерва в наступающие армии направлений; раз в ASSAULT_PERIOD_S секунд. */
export function commandAssaults(state: MatchState): void {
  if (state.tick % (ASSAULT_PERIOD_S * TICKS_PER_S) !== 0) return;
  const byOwner = new Map<number, Army[]>();
  for (const army of state.armies) {
    if (army.dir?.mode !== 'attack' || army.dir.target < 0) continue;
    const list = byOwner.get(army.owner);
    if (list) list.push(army);
    else byOwner.set(army.owner, [army]);
  }
  for (const [owner, armies] of byOwner) {
    deployReserve(state, owner, armies);
    for (const army of armies) assault(state, army);
    closePockets(state, owner, armies);
  }
}
