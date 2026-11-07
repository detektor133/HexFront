// Переходы отрядов гекс за гексом, захват пустых гексов, атака врага на пути, отсчёт отступления. Путь не пересчитывается (05-armies.md, «Движение»).
// GDD: docs/gdd/05-armies.md — «Движение», «Захват», «Приказы»
import { MAX_UNITS_PER_HEX, ORG_AFTER_RETREAT } from '../balance.ts';
import { gatherSystem } from './gather.ts';
import { TERRAIN } from '../map/types.ts';
import type { HexId } from '../math/hex.ts';
import { isHostileHex, ownUnitsAt, peaceBlocked, stepTicks } from '../queries/unit-path.ts';
import { captureHex } from '../state/capture.ts';
import { isPortOf } from '../state/port.ts';
import { isAllied } from '../state/relations.ts';
import type { Unit, MatchState } from '../state/types.ts';
import { moveUnit } from '../state/unit-index.ts';

// Сбрасывает путь; отряд с приказом move встаёт.
function stop(unit: Unit): void {
  unit.path = [];
  unit.moveTicks = 0;
  unit.moveTotal = 0;
  if (unit.order === 'move') unit.order = 'idle';
}

// Гекс стал непроходимым: отряд встаёт.
function blocked(state: MatchState, unit: Unit, next: HexId): boolean {
  // В воду можно ступить только плывущему отряду или из своего порта (звено составного пути).
  if (state.map.terrain[next] === TERRAIN.water) {
    return !unit.sea && !isPortOf(state, unit.owner, unit.hex);
  }
  if (peaceBlocked(state, unit.owner, next)) return true;
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

function startStep(state: MatchState, unit: Unit, next: HexId): boolean {
  if (blocked(state, unit, next)) {
    stop(unit);
    return false;
  }
  if (meetEnemy(state, unit, next)) return false;
  if (state.map.terrain[next] === TERRAIN.water) unit.sea = true;
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
  moveUnit(state, unit, next);
  unit.path.shift();
  unit.moveTicks = 0;
  unit.moveTotal = 0;
  // Союзную землю проходят без захвата (CR-007).
  const land = state.hexes.owner[next] ?? -1;
  const onWater = state.map.terrain[next] === TERRAIN.water;
  if (!onWater) unit.sea = false;
  if (!onWater && unit.type !== 'artillery' && !isAllied(state, unit.owner, land)) {
    captureHex(state, next, unit.owner);
  }
  if (unit.path.length === 0 && unit.order === 'move') unit.order = 'idle';
}

function advance(state: MatchState, unit: Unit): void {
  const next = unit.path[0];
  if (next === undefined) return stop(unit);
  if (unit.moveTotal === 0 && !startStep(state, unit, next)) return;
  // Шаг стал запрещён (мир, чужая земля для артиллерии): встаём сразу, а не после полного перехода.
  if (blocked(state, unit, next)) return stop(unit);
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

/** Двигает отряды с приказом move на тик; отряды — по возрастанию id. */
export function movementSystem(state: MatchState): void {
  for (const unit of state.units) {
    if (unit.order === 'move') advance(state, unit);
    else if (unit.order === 'retreat') retreatTick(unit);
  }
  gatherSystem(state);
}
