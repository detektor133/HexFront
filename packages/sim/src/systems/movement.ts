// Переходы армий гекс за гексом, захват пустых гексов, приказ expand. Путь не пересчитывается
// (05-armies.md, «Движение»); атака при входе во врага — 03/T5.
// GDD: docs/gdd/05-armies.md — «Движение», «Захват», «Приказы»
import { MAX_ARMIES_PER_HEX } from '../balance.ts';
import { TERRAIN } from '../map/types.ts';
import { hexFromId, hexId, inBounds, neighbors, type HexId } from '../math/hex.ts';
import { findNearestPath, isHostileHex, ownArmiesAt, stepTicks } from '../queries/army-path.ts';
import { captureHex } from '../state/capture.ts';
import { NEUTRAL, type Army, type MatchState } from '../state/types.ts';

// Сбрасывает путь; армия на экспансии сохраняет приказ и в следующий тик выбирает новую цель.
function stop(army: Army): void {
  army.path = [];
  army.moveTicks = 0;
  army.moveTotal = 0;
  if (army.order === 'move') army.order = 'idle';
}

// Гекс стал непроходимым или занят врагом: армия встаёт. Атака врага на пути появится в 03/T5.
function blocked(state: MatchState, army: Army, next: HexId): boolean {
  if (state.map.terrain[next] === TERRAIN.water) return true;
  if (army.type === 'artillery' && state.hexes.owner[next] !== army.owner) return true;
  return isHostileHex(state, army.owner, next);
}

const isFull = (state: MatchState, army: Army, hex: HexId): boolean =>
  ownArmiesAt(state, army.owner, hex) >= MAX_ARMIES_PER_HEX;

function borders(state: MatchState, owner: number, hex: HexId): boolean {
  const { width, height } = state.map;
  return neighbors(hexFromId(hex, width)).some(
    (n) => inBounds(n, width, height) && state.hexes.owner[hexId(n, width)] === owner,
  );
}

// Цель экспансии: ближайший по времени хода нейтральный пустой гекс у своей границы, кроме
// целей других своих армий на экспансии. Нет цели — приказ снимается.
function planExpand(state: MatchState, army: Army): void {
  const reserved = new Set<HexId>();
  for (const a of state.armies) {
    const target = a.path.at(-1);
    if (a !== army && a.owner === army.owner && a.order === 'expand' && target !== undefined) {
      reserved.add(target);
    }
  }
  const isGoal = (hex: HexId): boolean =>
    state.hexes.owner[hex] === NEUTRAL &&
    !reserved.has(hex) &&
    !isHostileHex(state, army.owner, hex) &&
    borders(state, army.owner, hex);
  const path = findNearestPath(state, army.hex, army.type, army.owner, isGoal);
  if (path) army.path = path;
  else army.order = 'idle';
}

function startStep(state: MatchState, army: Army, next: HexId): boolean {
  const target = army.path.at(-1);
  const lostTarget =
    army.order === 'expand' && target !== undefined && state.hexes.owner[target] !== NEUTRAL;
  if (lostTarget || blocked(state, army, next)) {
    stop(army);
    return false;
  }
  // Полный гекс впереди: ждём, пока освободится место.
  if (isFull(state, army, next)) return false;
  const ticks = stepTicks(state, army, army.hex, next);
  if (ticks === null) {
    stop(army);
    return false;
  }
  army.moveTotal = ticks;
  return true;
}

function arrive(state: MatchState, army: Army, next: HexId): void {
  army.hex = next;
  army.path.shift();
  army.moveTicks = 0;
  army.moveTotal = 0;
  if (army.type !== 'artillery') captureHex(state, next, army.owner);
  if (army.path.length === 0 && army.order === 'move') army.order = 'idle';
}

function advance(state: MatchState, army: Army): void {
  const next = army.path[0];
  if (next === undefined) return stop(army);
  if (army.moveTotal === 0 && !startStep(state, army, next)) return;
  if (army.moveTicks < army.moveTotal) army.moveTicks += 1;
  if (army.moveTicks < army.moveTotal) return;
  if (blocked(state, army, next)) return stop(army);
  if (isFull(state, army, next)) return;
  arrive(state, army, next);
}

/** Двигает армии с приказами move и expand на тик; армии — по возрастанию id. */
export function movementSystem(state: MatchState): void {
  for (const army of state.armies) {
    if (army.order === 'expand' && army.path.length === 0) planExpand(state, army);
    if (army.order === 'move' || army.order === 'expand') advance(state, army);
  }
}
