// Цепочка приказов Shift+ПКМ: каждая точка добавляется после предыдущих, отряд идёт по ним по
// порядку (sim: промежуточные точки `via` приказов move и attack), последняя точка — на вражеском
// гексе — атака. Обычный ПКМ заменяет цепочку новым приказом.
import { MAX_VIA_POINTS, type Command, type PlayerView } from '@hexfront/sim';

import { isHostile, pickedOwn, type Picked } from './sandbox-selection.ts';

/** Цепочка точек выбранной группы: ключ группы и гексы по порядку. */
export interface OrderQueue {
  readonly key: string;
  readonly points: readonly number[];
}

export const EMPTY_QUEUE: OrderQueue = { key: '', points: [] };

const keyOf = (ids: readonly number[]): string => [...ids].sort((a, b) => a - b).join(',');

/**
 * Точки цепочки, до которых группа ещё не дошла: те, что остались в пути ведущего отряда.
 * @returns оставшиеся точки по порядку
 */
export function remainingPoints(view: PlayerView, picked: Picked, queue: OrderQueue): number[] {
  const mine = pickedOwn(view, picked);
  const lead = mine[0];
  if (!lead || queue.key !== keyOf(mine.map((u) => u.id))) return [];
  return queue.points.filter((point) => lead.path.includes(point));
}

/**
 * Shift+ПКМ по гексу: добавляет точку в цепочку выбранных отрядов и сразу отдаёт приказ.
 * @returns новая цепочка и команда; null — цепочка полна или выбраны не свои отряды
 */
export function queueOrder(
  view: PlayerView,
  picked: Picked,
  hex: number,
  queue: OrderQueue,
): { readonly queue: OrderQueue; readonly cmd: Command } | null {
  const mine = pickedOwn(view, picked).filter((u) => u.order !== 'retreat');
  const lead = mine[0];
  if (!lead) return null;
  const key = keyOf(mine.map((u) => u.id));
  let base = remainingPoints(view, picked, queue);
  // Отряд уже идёт обычным приказом: цепочка продолжается с его конечной точки.
  if (base.length === 0 && lead.path.length > 0) base = [lead.path[lead.path.length - 1] as number];
  if (base[base.length - 1] === hex) return null;
  const points = [...base, hex];
  if (points.length > MAX_VIA_POINTS + 1) return null;
  const via = points.slice(0, -1);
  const unitIds = mine.map((u) => u.id);
  if (isHostile(view, hex)) {
    const attackers = mine.filter((u) => u.type !== 'artillery').map((u) => u.id);
    if (attackers.length === 0) return null;
    const cmd: Command = { t: 'attack', unitIds: attackers, target: hex };
    return { queue: { key, points }, cmd: via.length > 0 ? { ...cmd, via } : cmd };
  }
  const cmd: Command = { t: 'move', unitIds, to: hex };
  return { queue: { key, points }, cmd: via.length > 0 ? { ...cmd, via } : cmd };
}
