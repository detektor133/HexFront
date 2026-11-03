// Предпросмотр маршрута и времени в пути (CR-012): состояние матча не меняется.
import { isHostileHex, stepTicks } from './unit-path.ts';
import { routePath } from '../commands/unit.ts';
import type { HexId } from '../math/hex.ts';
import type { MatchState, Unit } from '../state/types.ts';

export interface PathPreview {
  /** Гексы пути самого медленного отряда после его гекса, включая цель. */
  readonly path: readonly HexId[];
  /** Время самого медленного отряда по `stepTicks`, тики. */
  readonly ticks: number;
  /** На пути стоит враг, видимый игроку (туман скрывает остальных). */
  readonly enemyOnPath: boolean;
}

function pathTicks(state: MatchState, unit: Unit, path: readonly HexId[]): number {
  let from = unit.hex;
  let total = 0;
  for (const hex of path) {
    total += stepTicks(state, unit, from, hex) ?? 0;
    from = hex;
  }
  return total;
}

/**
 * Считает путь через точки `via` и время для выбранных своих отрядов.
 * @returns null — нет своих отрядов или путь недостижим
 */
export function previewPath(
  state: MatchState,
  playerId: number,
  unitIds: readonly number[],
  to: HexId,
  via: readonly HexId[] = [],
): PathPreview | null {
  let slowest: { path: HexId[]; ticks: number } | null = null;
  for (const id of unitIds) {
    const unit = state.units.find((u) => u.id === id && u.owner === playerId);
    if (!unit) continue;
    const path = routePath(state, unit, via, to);
    if (!path) return null;
    const ticks = pathTicks(state, unit, path);
    if (!slowest || ticks > slowest.ticks) slowest = { path, ticks };
  }
  if (!slowest) return null;
  const visible = state.fog
    ? (state.vision?.visible[playerId] ?? null)
    : new Uint8Array(state.hexes.owner.length).fill(1);
  const enemyOnPath = slowest.path.some(
    (hex) => (visible?.[hex] ?? 1) === 1 && isHostileHex(state, playerId, hex),
  );
  return { path: slowest.path, ticks: slowest.ticks, enemyOnPath };
}
