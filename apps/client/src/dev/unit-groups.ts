import type { PlayerView, UnitView } from '@hexfront/sim';

import { chipHalf } from './chip-place.ts';

/** Позиция фишки отдельного отряда в стопке. */
export interface ChipGroup {
  readonly key: string;
  readonly units: readonly UnitView[];
  readonly moving: boolean;
  readonly stackOffset: number;
}

const inTransit = (u: UnitView): boolean =>
  u.moveTotal > 0 && u.path.length > 0 && u.order !== 'retreat';

/** Шаг стопки впритык (решение владельца 2026-11-02): фишки с рамкой выбора соприкасаются
 * краями, без зазора и без перекрытия — высота фишки с рамкой, `units.md`, «Стопка отрядов». */
export const CHIP_STACK_STEP = 2 * chipHalf();

/** Возвращает отдельную фишку на каждый отряд с устойчивым смещением внутри стопки. */
export function chipGroups(v: PlayerView, expanded: ReadonlySet<number> = new Set()): ChipGroup[] {
  const buckets = new Map<string, UnitView[]>();
  for (const unit of v.units) {
    const at = inTransit(unit) ? `m${unit.hex}>${unit.path[0] ?? -1}` : `h${unit.hex}`;
    const bucket = buckets.get(at);
    if (bucket) bucket.push(unit);
    else buckets.set(at, [unit]);
  }

  const result: ChipGroup[] = [];
  for (const units of buckets.values()) {
    units.sort((a, b) => a.id - b.id);
    // Одинаковые отряды одной армии с одним приказом — одна фишка с числом (HoI4: стопка).
    const merged = new Map<string, UnitView[]>();
    for (const unit of units) {
      const key = `${unit.owner}|${unit.type}|${unit.armyId}|${unit.order}|${unit.target}`;
      const same = merged.get(key);
      if (same) same.push(unit);
      else merged.set(key, [unit]);
    }
    // Выбранная стопка раскрывается в столбик отдельных фишек, пока выделена.
    const stacks = [...merged.values()].flatMap((s) =>
      s.some((u) => expanded.has(u.id)) ? s.map((u) => [u]) : [s],
    );
    const middle = (stacks.length - 1) / 2;
    for (let index = 0; index < stacks.length; index += 1) {
      const stack = stacks[index];
      const unit = stack?.[0];
      if (!stack || !unit) continue;
      result.push({
        key: `u${unit.id}`,
        units: stack,
        moving: inTransit(unit),
        stackOffset: (index - middle) * 2 * chipHalf(),
      });
    }
  }
  return result;
}
