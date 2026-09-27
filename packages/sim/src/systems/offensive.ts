// Наступление армий с линией фронта до линии наступления (CR-002, как в HoI4; 04/T14b).
// Наступают только отряды на гранях фронта, смотрящих на линию, и только шагом, после которого
// они строго ближе к линии; за линию не идут.
// GDD: docs/gdd/07-controls.md — «Линия наступления».
import { MAX_UNITS_PER_HEX, OFFENSIVE_STEP_TICKS, OFFENSIVE_STOP_ORG } from '../balance.ts';
import { setOffensive } from '../commands/plan.ts';
import type { HexId } from '../math/hex.ts';
import { forecastInState } from '../queries/forecast.ts';
import { isHostileHex, ownUnitsAt } from '../queries/unit-path.ts';
import { flipEdge, isBorderEdge, type EdgeId } from '../state/edges.ts';
import { facingHexes, lineDistance, stepsToward } from '../state/offensive-steps.ts';
import type { ArmyPlan, MatchState, Unit } from '../state/types.ts';

type FrontPlan = Extract<ArmyPlan, { kind: 'front' }>;

// Первый из шагов к линии, куда можно войти: не выбран другим, есть место, в занятый врагом —
// только если прогноз не «Поражение».
function pickStep(
  state: MatchState,
  u: Unit,
  steps: readonly HexId[],
  taken: ReadonlySet<HexId>,
): HexId | null {
  for (const n of steps) {
    if (taken.has(n) || ownUnitsAt(state, u.owner, n) >= MAX_UNITS_PER_HEX) continue;
    if (isHostileHex(state, u.owner, n) && forecastInState(state, [u], n).outcome === 'defeat') {
      continue;
    }
    return n;
  }
  return null;
}

// Наступающий отряд: свободный, не артиллерия, org не ниже порога, на гексе смотрящей грани.
const advancing = (u: Unit, armyId: number, facing: ReadonlySet<HexId>): boolean =>
  u.armyId === armyId &&
  u.order === 'idle' &&
  !u.inBattle &&
  u.type !== 'artillery' &&
  u.org >= OFFENSIVE_STOP_ORG &&
  facing.has(u.hex);

// Вся линия своя — как в HoI4: линия наступления становится фронтом армии (её грани, ставшие своей
// границей, со своей стороны), линия и стрелки исчезают. Граней границы нет — фронт прежний.
function finish(state: MatchState, plan: FrontPlan, owner: number, line: readonly EdgeId[]): void {
  const own = line
    .map((e) => (isBorderEdge(state, owner, e) ? e : flipEdge(state, e)))
    .filter((e) => e >= 0 && isBorderEdge(state, owner, e));
  // Грани линии по порядку, без достройки обходом по границе: фронт — ровно линия (кусками, если
  // часть граней линии не стала границей).
  const edges = own.length > 0 ? own : [...plan.edges];
  const i = state.plans.findIndex((p) => p.armyId === plan.armyId);
  state.plans[i] = { ...plan, edges, offensive: null };
  state.events.push({ t: 'offensiveDone', playerId: owner, armyId: plan.armyId });
}

function advance(state: MatchState, plan: FrontPlan): void {
  const off = plan.offensive;
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (!off || owner === undefined) return;
  if (off.hexes.every((h) => state.hexes.owner[h] === owner)) {
    finish(state, plan, owner, off.edges);
    return;
  }
  const dist = lineDistance(state, off.hexes);
  const facing = new Set(facingHexes(state, plan.edges, dist));
  const taken = new Set<HexId>();
  let progress = state.units.some((u) => u.armyId === plan.armyId && u.inBattle);
  for (const u of state.units) {
    if (!advancing(u, plan.armyId, facing)) continue;
    const steps = stepsToward(state, owner, u.hex, dist);
    const step = pickStep(state, u, steps, taken);
    if (step === null) continue;
    taken.add(step);
    progress = true;
    u.slot = -1;
    u.path = [step];
    u.moveTicks = 0;
    u.moveTotal = 0;
    u.order = 'move';
  }
  if (progress) setOffensive(state, plan.armyId, { ...off, progressTick: state.tick });
}

/**
 * Раз в OFFENSIVE_STEP_TICKS (армии — в разные тики) наступающие отряды армии делают шаг к линии;
 * взятая целиком линия становится фронтом армии, наступление завершается событием offensiveDone.
 */
export function offensiveSystem(state: MatchState): void {
  for (const plan of state.plans) {
    if (plan.kind !== 'front' || !plan.offensive?.active) continue;
    if ((state.tick + plan.armyId) % OFFENSIVE_STEP_TICKS !== 0) continue;
    advance(state, plan);
  }
}
