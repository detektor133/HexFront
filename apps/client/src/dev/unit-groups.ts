// Группы отрядов для фишек (art/units.md, «Группа отрядов»): одна фишка — все отряды одного игрока
// в одном месте карты: стоящие в одном гексе или идущие одним переходом (из того же гекса в тот же
// гекс с одинаковым прогрессом). Разошедшиеся отряды — разные фишки.
import type { PlayerView, UnitView } from '@hexfront/sim';

/** Группа отрядов одной фишки. */
export interface ChipGroup {
  /** Ключ фишки: у стоящих — игрок и гекс, у идущих — переход и меньший id группы. */
  readonly key: string;
  readonly units: readonly UnitView[];
  /** Группа идёт переходом между гексами. */
  readonly moving: boolean;
}

// Отряд сейчас в переходе между гексами (отступающие рисуются в своём гексе).
const inTransit = (u: UnitView): boolean =>
  u.moveTotal > 0 && u.path.length > 0 && u.order !== 'retreat';

/**
 * Группы отрядов снимка по порядку появления: стоящие — по гексу, идущие — по переходу и
 * прогрессу.
 * @returns группы; у каждого отряда — ровно одна
 */
export function chipGroups(v: PlayerView): ChipGroup[] {
  const groups = new Map<string, { moving: boolean; units: UnitView[] }>();
  for (const u of v.units) {
    const at = inTransit(u)
      ? `m${u.owner}:${u.hex}>${u.path[0] ?? -1}:${u.moveTicks}/${u.moveTotal}`
      : `h${u.owner}:${u.hex}`;
    const g = groups.get(at);
    if (g) g.units.push(u);
    else groups.set(at, { moving: inTransit(u), units: [u] });
  }
  // Прогресс перехода меняется каждый тик — ключ фишки идущей группы от него не зависит.
  return [...groups].map(([at, g]) => {
    const minId = Math.min(...g.units.map((u) => u.id));
    const key = g.moving ? `${at.slice(0, at.lastIndexOf(':'))}:u${minId}` : at;
    return { key, units: g.units, moving: g.moving };
  });
}
