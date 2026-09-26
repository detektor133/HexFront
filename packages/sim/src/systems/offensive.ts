// Наступление армий с линией фронта до линии наступления (CR-002, как в HoI4).
// GDD: docs/gdd/07-controls.md — «Линия наступления».
import { MAX_UNITS_PER_HEX, OFFENSIVE_STEP_TICKS, OFFENSIVE_STOP_ORG } from '../balance.ts';
import { setOffensive } from '../commands/plan.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { forecastInState } from '../queries/forecast.ts';
import { isHostileHex, ownUnitsAt } from '../queries/unit-path.ts';
import { followBorder, planHexes } from '../state/front.ts';
import { offensiveZone } from '../state/offensive-zone.ts';
import type { ArmyPlan, MatchState, Unit } from '../state/types.ts';

type FrontPlan = Extract<ArmyPlan, { kind: 'front' }>;

function around(state: MatchState, hex: HexId): HexId[] {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width))
    .filter((n) => inBounds(n, width, height))
    .map((n) => hexId(n, width));
}

// Соседний гекс зоны, ближайший к линии (ничьи — меньший HexId); уже выбранные и полные — нет.
function pickStep(
  state: MatchState,
  u: Unit,
  zone: ReadonlyMap<HexId, number>,
  taken: ReadonlySet<HexId>,
): HexId | null {
  let best: HexId | null = null;
  let bestDt = Number.MAX_SAFE_INTEGER;
  for (const n of around(state, u.hex).sort((a, b) => a - b)) {
    const dt = zone.get(n);
    if (dt === undefined || dt >= bestDt || taken.has(n)) continue;
    if (ownUnitsAt(state, u.owner, n) >= MAX_UNITS_PER_HEX) continue;
    // В занятый врагом гекс — только если прогноз не «Поражение».
    if (isHostileHex(state, u.owner, n) && forecastInState(state, [u], n).outcome === 'defeat') {
      continue;
    }
    best = n;
    bestDt = dt;
  }
  return best;
}

function advance(state: MatchState, plan: FrontPlan, line: readonly HexId[]): void {
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (owner === undefined) return;
  const zone = offensiveZone(state, owner, planHexes(state, plan), line);
  if (zone.size === 0) {
    setOffensive(state, plan.armyId, null);
    state.events.push({ t: 'offensiveDone', playerId: owner, armyId: plan.armyId });
    return;
  }
  const taken = new Set<HexId>();
  for (const u of state.units) {
    if (u.armyId !== plan.armyId || u.order !== 'idle' || u.inBattle) continue;
    if (u.type === 'artillery' || u.org < OFFENSIVE_STOP_ORG) continue;
    const step = pickStep(state, u, zone, taken);
    if (step === null) continue;
    taken.add(step);
    u.slot = -1;
    u.path = [step];
    u.moveTicks = 0;
    u.moveTotal = 0;
    u.order = 'move';
  }
}

/**
 * Раз в OFFENSIVE_STEP_TICKS (армии — в разные тики) свободные отряды армии с линией
 * наступления делают шаг к ней; взятая зона завершает наступление событием offensiveDone.
 */
export function offensiveSystem(state: MatchState): void {
  for (const plan of state.plans) {
    if (plan.kind !== 'front' || !plan.offensive?.active) continue;
    if ((state.tick + plan.armyId) % OFFENSIVE_STEP_TICKS !== 0) continue;
    followBorder(state, plan.armyId);
    const now = state.plans.find((p) => p.armyId === plan.armyId);
    if (now?.kind === 'front' && now.offensive) advance(state, now, now.offensive.hexes);
  }
}
