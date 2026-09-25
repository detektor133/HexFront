// Переходы армий гекс за гексом; путь не пересчитывается (05-armies.md, «Движение»).
// Захват пустых гексов — 03/T3, атака при входе во врага — 03/T5.
// GDD: docs/gdd/05-armies.md — «Движение»
import { MAX_ARMIES_PER_HEX } from '../balance.ts';
import { TERRAIN } from '../map/types.ts';
import type { HexId } from '../math/hex.ts';
import { isHostileHex, ownArmiesAt, stepTicks } from '../queries/army-path.ts';
import type { Army, MatchState } from '../state/types.ts';

function stop(army: Army): void {
  army.path = [];
  army.moveTicks = 0;
  army.moveTotal = 0;
  army.order = 'idle';
}

// Гекс стал непроходимым или занят врагом: армия встаёт. Атака врага на пути появится в 03/T5.
function blocked(state: MatchState, army: Army, next: HexId): boolean {
  if (state.map.terrain[next] === TERRAIN.water) return true;
  if (army.type === 'artillery' && state.hexes.owner[next] !== army.owner) return true;
  return isHostileHex(state, army.owner, next);
}

const isFull = (state: MatchState, army: Army, hex: HexId): boolean =>
  ownArmiesAt(state, army.owner, hex) >= MAX_ARMIES_PER_HEX;

function advance(state: MatchState, army: Army): void {
  const next = army.path[0];
  if (next === undefined) return stop(army);
  if (army.moveTotal === 0) {
    if (blocked(state, army, next)) return stop(army);
    // Полный гекс впереди: ждём, пока освободится место.
    if (isFull(state, army, next)) return;
    const ticks = stepTicks(state, army, army.hex, next);
    if (ticks === null) return stop(army);
    army.moveTotal = ticks;
  }
  if (army.moveTicks < army.moveTotal) army.moveTicks += 1;
  if (army.moveTicks < army.moveTotal) return;
  if (blocked(state, army, next)) return stop(army);
  if (isFull(state, army, next)) return;
  army.hex = next;
  army.path.shift();
  army.moveTicks = 0;
  army.moveTotal = 0;
  if (army.path.length === 0) army.order = 'idle';
}

/** Двигает армии с приказом move на тик; армии обрабатываются по возрастанию id. */
export function movementSystem(state: MatchState): void {
  for (const army of state.armies) {
    if (army.order === 'move') advance(state, army);
  }
}
