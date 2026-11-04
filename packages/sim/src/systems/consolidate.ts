// Слияние мелочи (07-controls.md, «Меню страны»): остатки после боёв и мелкие отряды резерва
// сами стягиваются к ближайшему отряду своего типа и армии и сливаются, чтобы войско не рассыпалось
// на сотни отрядов по 1–7 солдат. Раз в CONSOLIDATE_PERIOD_S секунд; в бою отряд не трогается.
import {
  CONSOLIDATE_CROWD,
  CONSOLIDATE_MAX,
  CONSOLIDATE_PERIOD_S,
  CONSOLIDATE_SAFE,
  MAX_UNITS_PER_HEX,
  MERGE_SMALL_BELOW,
  MERGE_SMALL_TINY,
  MERGE_SMALL_RADIUS,
  TICKS_PER_S,
} from '../balance.ts';
import { mergeUnits } from '../commands/unit.ts';
import { distance, hexFromId } from '../math/hex.ts';
import { findPath, ownUnitsAt } from '../queries/unit-path.ts';
import { SLOT_DETACHED } from '../state/allocate.ts';
import { planHexes } from '../state/front.ts';
import { atWar } from '../state/relations.ts';
import type { MatchState, Unit } from '../state/types.ts';
import { allUnits } from '../state/unit-index.ts';

const free = (u: Unit): boolean => !u.inBattle && u.order !== 'retreat' && u.order !== 'attack';

/** Сливает мелкие отряды с ближайшими своими той же армии и типа; мелкий идёт к крупному. */
export function consolidate(state: MatchState): void {
  if (state.tick % (CONSOLIDATE_PERIOD_S * TICKS_PER_S) !== 0) return;
  const { width } = state.map;
  const groups = new Map<string, Unit[]>();
  // Армия занимает ничью землю роем (нет плана) — её отряды не стягиваем: рой на то и рассыпан.
  const planned = new Set(state.plans.map((p) => p.armyId));
  const foes = allUnits(state).filter((u) => state.players[u.owner] !== undefined);
  const nearFoe = (u: Unit): boolean =>
    foes.some(
      (e) =>
        e.owner !== u.owner &&
        atWar(state, u.owner, e.owner) &&
        distance(hexFromId(u.hex, width), hexFromId(e.hex, width)) <= CONSOLIDATE_SAFE,
    );
  for (const u of allUnits(state)) {
    if (u.type === 'artillery' || u.slot === SLOT_DETACHED) continue;
    const key = `${u.owner}|${u.armyId}|${u.type}`;
    const list = groups.get(key);
    if (list) list.push(u);
    else groups.set(key, [u]);
  }
  // Размер войска игрока: в толпе (больше CONSOLIDATE_CROWD отрядов) мелочь — всё меньше MERGE_SMALL_BELOW,
  // иначе только совсем крошечные отряды.
  const crowd = new Map<number, number>();
  const perArmy = new Map<number | null, number>();
  for (const u of allUnits(state)) {
    crowd.set(u.owner, (crowd.get(u.owner) ?? 0) + 1);
    if (u.type !== 'artillery') perArmy.set(u.armyId, (perArmy.get(u.armyId) ?? 0) + 1);
  }
  // Гексов линии у армии с планом: пока отрядов не больше, армия делится, а не сливается.
  const lineHexes = new Map(
    state.plans.map((p) => [p.armyId, planHexes(state, p).length] as const),
  );
  for (const units of groups.values()) {
    const armyId = units[0]?.armyId ?? null;
    const surplus = armyId === null || (perArmy.get(armyId) ?? 0) > (lineHexes.get(armyId) ?? 0);
    const crowded = surplus && (crowd.get(units[0]?.owner ?? -1) ?? 0) > CONSOLIDATE_CROWD;
    const below = crowded ? MERGE_SMALL_BELOW : MERGE_SMALL_TINY;
    // Совсем крошечный отряд бесполезен где угодно; больший — только у армии с планом или в резерве и
    // не рядом с врагом (роящаяся армия рассыпана намеренно, фронт у врага не трогаем).
    const calm = (u: Unit): boolean => (u.armyId === null || planned.has(u.armyId)) && !nearFoe(u);
    const small = units.filter(
      (u) => free(u) && (u.soldiers < MERGE_SMALL_TINY || (u.soldiers < below && calm(u))),
    );
    if (small.length === 0 || units.length < 2) continue;
    const taken = new Set<number>();
    for (const a of small) {
      if (taken.has(a.id)) continue;
      const at = hexFromId(a.hex, width);
      let best: Unit | null = null;
      let bestD = Number.MAX_SAFE_INTEGER;
      for (const b of units) {
        if (b.id === a.id || taken.has(b.id) || !free(b)) continue;
        // Мелкий идёт к крупному; из двух мелких — к меньшему id: пара не расходится.
        if (b.soldiers < a.soldiers || (b.soldiers === a.soldiers && b.id > a.id)) continue;
        if (a.soldiers + b.soldiers > CONSOLIDATE_MAX) continue;
        const d = distance(at, hexFromId(b.hex, width));
        if (d <= MERGE_SMALL_RADIUS && d < bestD) {
          best = b;
          bestD = d;
        }
      }
      if (!best) continue;
      taken.add(a.id);
      taken.add(best.id);
      if (best.hex === a.hex) {
        mergeUnits(state, [a, best]);
        continue;
      }
      if (ownUnitsAt(state, a.owner, best.hex) >= MAX_UNITS_PER_HEX) continue;
      const path = findPath(state, a.hex, best.hex, a.type, a.owner, true);
      if (!path || path.length === 0) continue;
      a.path = path;
      a.moveTicks = 0;
      a.moveTotal = 0;
      a.slot = -1;
      a.order = 'move';
    }
  }
}
