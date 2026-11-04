// Наступление армий с линией фронта до линии наступления (CR-002, как в HoI4; 04/T14b).
// Наступают только отряды на гранях фронта, смотрящих на линию, и только шагом, после которого
// они строго ближе к линии; за линию не идут.
// GDD: docs/gdd/07-controls.md — «Линия наступления».
import { MAX_UNITS_PER_HEX, OFFENSIVE_STEP_TICKS, OFFENSIVE_STOP_ORG } from '../balance.ts';
import { setOffensive } from '../commands/plan.ts';
import type { HexId } from '../math/hex.ts';
import { forecastInState } from '../queries/forecast.ts';
import { isHostileHex, ownUnitsAt } from '../queries/unit-path.ts';
import { edgeAt } from '../state/contour.ts';
import {
  cornerKey,
  edgeCorners,
  flipEdge,
  isBorderEdge,
  type Corner,
  type EdgeId,
} from '../state/edges.ts';
import { borderArc } from '../state/front-follow.ts';
import { trimAutoFront } from '../state/front.ts';
import {
  enclaveHexes,
  facingHexes,
  lineDistance,
  neighborsIn,
  stepsToward,
} from '../state/offensive-steps.ts';
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

// Свободный отряд армии: стоит, не в бою, не артиллерия, org не ниже порога.
const free = (u: Unit, armyId: number): boolean =>
  u.armyId === armyId &&
  u.order === 'idle' &&
  !u.inBattle &&
  u.type !== 'artillery' &&
  u.org >= OFFENSIVE_STOP_ORG;

// Наступающий отряд: свободный, на гексе смотрящей грани.
const advancing = (u: Unit, armyId: number, facing: ReadonlySet<HexId>): boolean =>
  free(u, armyId) && facing.has(u.hex);

// Вся линия своя и анклавов нет — как в HoI4: фронт армии — дуга своей границы от угла начала
// линии до угла конца (контур, как в «Линии фронта»), линия и стрелки исчезают. Дуги нет — фронт
// прежний.
function finish(state: MatchState, plan: FrontPlan, owner: number, line: readonly EdgeId[]): void {
  const first = line[0];
  const last = line.at(-1);
  const marks = line.map((e) => (isBorderEdge(state, owner, e) ? e : flipEdge(state, e)));
  // Грани границы у внешних углов концов линии: дуга идёт от угла до угла.
  for (const [e, next] of [
    [first, line[1]],
    [last, line.at(-2)],
  ] as const) {
    if (e === undefined) continue;
    for (const c of edgeCorners(e)) {
      if (next !== undefined && touchesCorner(state, next, c)) continue;
      marks.push(edgeAt(state, owner, c, 0), edgeAt(state, owner, c, 1));
    }
  }
  const arc = borderArc(state, owner, marks);
  const edges = arc.length > 0 ? arc : [...plan.edges];
  const i = state.plans.findIndex((p) => p.armyId === plan.armyId);
  state.plans[i] = { ...plan, edges, offensive: null };
  trimAutoFront(state, plan.armyId);
  state.events.push({ t: 'offensiveDone', playerId: owner, armyId: plan.armyId });
}

// Угол c — один из углов грани e.
function touchesCorner(state: MatchState, e: EdgeId, c: Corner): boolean {
  const key = cornerKey(state, c);
  return edgeCorners(e).some((x) => cornerKey(state, x) === key);
}

function advance(state: MatchState, plan: FrontPlan): void {
  const off = plan.offensive;
  const owner = state.armies.find((a) => a.id === plan.armyId)?.owner;
  if (!off || owner === undefined) return;
  // Анклавы у взятой земли — тоже цель наступления, независимо от dt.
  const enclaves = new Set(enclaveHexes(state, owner, off.taken));
  if (enclaves.size === 0 && off.hexes.every((h) => state.hexes.owner[h] === owner)) {
    finish(state, plan, owner, off.edges);
    return;
  }
  const dist = lineDistance(state, off.hexes);
  const facing = new Set(facingHexes(state, plan.edges, dist));
  const taken = new Set<HexId>();
  let progress = state.units.some((u) => u.armyId === plan.armyId && u.inBattle);
  for (const u of state.units) {
    const near = neighborsIn(state, u.hex, enclaves);
    if (!advancing(u, plan.armyId, facing) && !(near.length > 0 && free(u, plan.armyId))) continue;
    const toward = facing.has(u.hex) ? stepsToward(state, owner, u.hex, dist) : [];
    const steps = [...toward, ...near.filter((h) => !toward.includes(h))];
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
  if (!progress) return;
  const all = [...new Set([...off.taken, ...taken])].sort((a, b) => a - b);
  setOffensive(state, plan.armyId, { ...off, progressTick: state.tick, taken: all });
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
