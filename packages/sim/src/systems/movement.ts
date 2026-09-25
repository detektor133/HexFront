// Переходы отрядов гекс за гексом, захват пустых гексов, приказ expand, атака врага на пути,
// отсчёт отступления. Путь не пересчитывается (05-armies.md, «Движение»).
// GDD: docs/gdd/05-armies.md — «Движение», «Захват», «Приказы»
import { MAX_UNITS_PER_HEX, ORG_AFTER_RETREAT } from '../balance.ts';
import { TERRAIN } from '../map/types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { findNearestPath, isHostileHex, ownUnitsAt, stepTicks } from '../queries/unit-path.ts';
import { captureHex } from '../state/capture.ts';
import { NEUTRAL, type Unit, type MatchState } from '../state/types.ts';

// Сбрасывает путь; отряд на экспансии сохраняет приказ и в следующий тик выбирает новую цель.
function stop(unit: Unit): void {
  unit.path = [];
  unit.moveTicks = 0;
  unit.moveTotal = 0;
  if (unit.order === 'move') unit.order = 'idle';
}

// Гекс стал непроходимым: отряд встаёт.
function blocked(state: MatchState, unit: Unit, next: HexId): boolean {
  if (state.map.terrain[next] === TERRAIN.water) return true;
  return unit.type === 'artillery' && state.hexes.owner[next] !== unit.owner;
}

// Враг на следующем гексе: отряд с приказом move атакует его (06-combat.md), остальные встают.
function meetEnemy(state: MatchState, unit: Unit, next: HexId): boolean {
  if (!isHostileHex(state, unit.owner, next)) return false;
  const attack = unit.order === 'move';
  stop(unit);
  if (attack) {
    unit.order = 'attack';
    unit.target = next;
  }
  return true;
}

const isFull = (state: MatchState, unit: Unit, hex: HexId): boolean =>
  ownUnitsAt(state, unit.owner, hex) >= MAX_UNITS_PER_HEX;

function borders(state: MatchState, owner: number, hex: HexId): boolean {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width)).some(
    (n) => inBounds(n, width, height) && state.hexes.owner[hexId(n, width)] === owner,
  );
}

// Цель экспансии: ближайший по времени хода нейтральный пустой гекс у своей границы, кроме
// целей других своих отрядов на экспансии. Нет цели — приказ снимается.
function planExpand(state: MatchState, unit: Unit): void {
  const reserved = new Set<HexId>();
  for (const a of state.units) {
    const target = a.path.at(-1);
    if (a !== unit && a.owner === unit.owner && a.order === 'expand' && target !== undefined) {
      reserved.add(target);
    }
  }
  const isGoal = (hex: HexId): boolean =>
    state.hexes.owner[hex] === NEUTRAL &&
    !reserved.has(hex) &&
    !isHostileHex(state, unit.owner, hex) &&
    borders(state, unit.owner, hex);
  const path = findNearestPath(state, unit.hex, unit.type, unit.owner, isGoal);
  if (path) unit.path = path;
  else unit.order = 'idle';
}

function startStep(state: MatchState, unit: Unit, next: HexId): boolean {
  const target = unit.path.at(-1);
  const lostTarget =
    unit.order === 'expand' && target !== undefined && state.hexes.owner[target] !== NEUTRAL;
  if (lostTarget || blocked(state, unit, next)) {
    stop(unit);
    return false;
  }
  if (meetEnemy(state, unit, next)) return false;
  // Полный гекс впереди: ждём, пока освободится место.
  if (isFull(state, unit, next)) return false;
  const ticks = stepTicks(state, unit, unit.hex, next);
  if (ticks === null) {
    stop(unit);
    return false;
  }
  unit.moveTotal = ticks;
  return true;
}

function arrive(state: MatchState, unit: Unit, next: HexId): void {
  unit.hex = next;
  unit.path.shift();
  unit.moveTicks = 0;
  unit.moveTotal = 0;
  if (unit.type !== 'artillery') captureHex(state, next, unit.owner);
  if (unit.path.length === 0 && unit.order === 'move') unit.order = 'idle';
}

function advance(state: MatchState, unit: Unit): void {
  const next = unit.path[0];
  if (next === undefined) return stop(unit);
  if (unit.moveTotal === 0 && !startStep(state, unit, next)) return;
  if (unit.moveTicks < unit.moveTotal) unit.moveTicks += 1;
  if (unit.moveTicks < unit.moveTotal) return;
  if (blocked(state, unit, next)) return stop(unit);
  if (meetEnemy(state, unit, next)) return;
  if (isFull(state, unit, next)) return;
  arrive(state, unit, next);
}

// Отступление уже перенесло отряд; здесь идёт только его время, затем org = ORG_AFTER_RETREAT.
function retreatTick(unit: Unit): void {
  unit.moveTicks += 1;
  if (unit.moveTicks < unit.moveTotal) return;
  unit.moveTicks = 0;
  unit.moveTotal = 0;
  unit.order = 'idle';
  unit.org = ORG_AFTER_RETREAT;
}

/** Двигает отряды с приказами move и expand на тик; отряды — по возрастанию id. */
export function movementSystem(state: MatchState): void {
  for (const unit of state.units) {
    if (unit.order === 'expand' && unit.path.length === 0) planExpand(state, unit);
    if (unit.order === 'move' || unit.order === 'expand') advance(state, unit);
    else if (unit.order === 'retreat') retreatTick(unit);
  }
}
