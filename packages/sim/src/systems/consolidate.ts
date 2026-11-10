// Слияние мелочи (07-controls.md, «Меню страны»): остатки после боёв и мелкие отряды резерва
// сами стягиваются к ближайшему отряду своего типа и армии и сливаются, чтобы войско не рассыпалось
// на сотни отрядов по 1–7 солдат. Раз в CONSOLIDATE_PERIOD_S секунд; в бою отряд не трогается.
import {
  CONSOLIDATE_CROWD,
  CONSOLIDATE_MAX,
  CONSOLIDATE_MAX_CEIL,
  CONSOLIDATE_UNITS_TARGET,
  CONSOLIDATE_PERIOD_S,
  CONSOLIDATE_SAFE,
  MAX_UNITS_PER_HEX,
  MERGE_SMALL_BELOW,
  MERGE_SMALL_TINY,
  MERGE_SMALL_RADIUS,
  TICKS_PER_S,
} from '../balance.ts';
import { mergeUnits } from '../commands/unit.ts';
import { distance, hexFromId, hexId, inBounds, spiral } from '../math/hex.ts';
import { intDiv } from '../math/int.ts';
import { findPath, ownUnitsAt } from '../queries/unit-path.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import { atWar } from '../state/relations.ts';
import { recentlyLeft } from '../state/return-lock.ts';
import type { MatchState, Unit } from '../state/types.ts';
import { allUnits, unitIndex } from '../state/unit-index.ts';

/**
 * Предел отряда при слиянии, fixed-point: CONSOLIDATE_MAX для небольшого войска, а у большого —
 * войско / CONSOLIDATE_UNITS_TARGET, но не больше CONSOLIDATE_MAX_CEIL.
 */
export function unitCap(totalSoldiers: number): number {
  return Math.min(
    CONSOLIDATE_MAX_CEIL,
    Math.max(CONSOLIDATE_MAX, intDiv(totalSoldiers, CONSOLIDATE_UNITS_TARGET)),
  );
}

const free = (u: Unit): boolean => !u.inBattle && u.order !== 'retreat' && u.order !== 'attack';

/** Сливает мелкие отряды с ближайшими своими той же армии и типа; мелкий идёт к крупному. */
export function consolidate(state: MatchState): void {
  if (state.tick % (CONSOLIDATE_PERIOD_S * TICKS_PER_S) !== 0) return;
  const { width } = state.map;
  const groups = new Map<string, Unit[]>();
  // Армия занимает ничью землю роем (нет плана) — её отряды не стягиваем: рой на то и рассыпан.
  const planned = new Set(state.plans.map((p) => p.armyId));
  // Враг рядом ищется по индексу гексов в радиусе CONSOLIDATE_SAFE, а не перебором всех отрядов
  // для каждого отряда: на тысячах отрядов перебор давал заметный провал раз в период слияния.
  const { unitsByHex } = unitIndex(state);
  const { height } = state.map;
  const nearFoe = (u: Unit): boolean => {
    for (const h of spiral(hexFromId(u.hex, width), CONSOLIDATE_SAFE)) {
      if (!inBounds(h, width, height)) continue;
      for (const e of unitsByHex[hexId(h, width)] ?? []) {
        if (
          e.owner !== u.owner &&
          state.players[e.owner] !== undefined &&
          atWar(state, u.owner, e.owner)
        ) {
          return true;
        }
      }
    }
    return false;
  };
  for (const u of allUnits(state)) {
    if (u.type === 'artillery' || u.slot === SLOT_DETACHED) continue;
    const key = `${u.owner}|${u.armyId}|${u.type}`;
    const list = groups.get(key);
    if (list) list.push(u);
    else groups.set(key, [u]);
  }
  // Размер войска игрока: в толпе (больше CONSOLIDATE_CROWD отрядов) мелочь — всё меньше MERGE_SMALL_BELOW,
  // иначе только совсем крошечные отряды. Отрядов в каждой армии (резерв — null): излишек над
  // гексами линии разрешает слияние.
  const crowd = new Map<number, number>();
  const perArmy = new Map<number | null, number>();
  // Предел отряда командир выбирает по размеру войска: чем больше войско, тем крупнее отряды, чтобы
  // массовая армия не рассыпалась на сотни мелких (а сотни фишек не тормозили игру).
  const soldiersOf = new Map<number, number>();
  for (const u of allUnits(state)) {
    crowd.set(u.owner, (crowd.get(u.owner) ?? 0) + 1);
    if (u.type !== 'artillery')
      soldiersOf.set(u.owner, (soldiersOf.get(u.owner) ?? 0) + u.soldiers);
    if (u.type !== 'artillery') perArmy.set(u.armyId, (perArmy.get(u.armyId) ?? 0) + 1);
  }
  // Гексов линии у армии с планом: пока отрядов не больше, армия делится, а не сливается.
  const lineHexes = new Map(
    state.plans.map((p) => [p.armyId, planHexes(state, p).length] as const),
  );

  const armyById = new Map(state.armies.map((x) => [x.id, x] as const));
  for (const units of groups.values()) {
    const armyId = units[0]?.armyId ?? null;
    const army = armyId === null ? undefined : armyById.get(armyId);
    // Мелочь стягивается сама у резерва, у армии с законченным направлением (`idle`) и у армии с
    // планом при избытке отрядов над гексами линии (иначе в линии появились бы дыры). Армии,
    // которыми игрок управляет вручную, и рой на ничьей земле остаются как расставлены.
    const isPlanned = armyId !== null && planned.has(armyId);
    const surplus =
      armyId === null ||
      army?.dir?.mode === 'idle' ||
      (isPlanned && (perArmy.get(armyId) ?? 0) > (lineHexes.get(armyId) ?? 0));
    // Совсем крошечный отряд бесполезен где угодно; больший — только в спокойном месте (не рядом с
    // врагом: фронт у врага не трогаем).
    const total = soldiersOf.get(units[0]?.owner ?? -1) ?? 0;
    const cap = unitCap(total);
    const below = Math.max(MERGE_SMALL_BELOW, intDiv(cap, 2));
    const crowded = surplus && (crowd.get(units[0]?.owner ?? -1) ?? 0) > CONSOLIDATE_CROWD;
    const calm = (u: Unit): boolean => crowded && !nearFoe(u);
    const small = units.filter(
      (u) => free(u) && (u.soldiers < MERGE_SMALL_TINY || (u.soldiers < below && calm(u))),
    );
    if (small.length === 0 || units.length < 2) continue;
    const smallIds = new Set(small.map((u) => u.id));
    const taken = new Set<number>();
    // Крупный отряд, к которому идут мелкие, принимает несколько за раз, пока не наберёт предел.
    const incoming = new Map<number, number>();
    for (const a of small) {
      if (taken.has(a.id)) continue;
      const at = hexFromId(a.hex, width);
      let best: Unit | null = null;
      let bestD = Number.MAX_SAFE_INTEGER;
      for (const b of units) {
        if (b.id === a.id || taken.has(b.id) || !free(b)) continue;
        // Мелкий идёт к крупному; из двух мелких — к меньшему id: пара не расходится.
        if (b.soldiers < a.soldiers || (b.soldiers === a.soldiers && b.id > a.id)) continue;
        if (a.soldiers + b.soldiers + (incoming.get(b.id) ?? 0) > cap) continue;
        if (recentlyLeft(state, a, b.hex)) continue;
        const d = distance(at, hexFromId(b.hex, width));
        if (d <= MERGE_SMALL_RADIUS && d < bestD) {
          best = b;
          bestD = d;
        }
      }
      if (!best) continue;
      taken.add(a.id);
      if (smallIds.has(best.id)) taken.add(best.id);
      else incoming.set(best.id, (incoming.get(best.id) ?? 0) + a.soldiers);
      if (best.hex === a.hex) {
        mergeUnits(state, [a, best]);
        continue;
      }
      if (ownUnitsAt(state, a.owner, best.hex) >= MAX_UNITS_PER_HEX) continue;
      // Идущий отряд не бросает начатый шаг: путь строится от гекса, в который он уже вступает.
      const entering = a.order === 'move' && a.moveTotal > 0 ? a.path[0] : undefined;
      const path = findPath(state, entering ?? a.hex, best.hex, a.type, a.owner, true);
      if (!path) continue;
      if (entering === undefined) {
        if (path.length === 0) continue;
        a.path = path;
        a.moveTicks = 0;
        a.moveTotal = 0;
      } else {
        a.path = [entering, ...path];
      }
      a.slot = -1;
      a.order = 'move';
    }
  }
}
