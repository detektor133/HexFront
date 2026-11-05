// Раздача ничьих гексов свободным отрядам (занятие ничьей земли, 07-controls.md и 09-bots.md).
// Одно правило для направления игрока и для commander бота: пары «отряд — гекс» выбираются по
// близости с поправкой на приоритет гекса (плотный рост земли), поэтому отряд рядом со свободной
// клеткой занимает её, а не бежит на другой конец страны; когда гексов больше, чем отрядов,
// крупные отряды делятся поровну на столько частей, сколько свободных гексов рядом.
import type { HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';

/** Отряд, которому ищется гекс. */
export interface ExpansionUnit {
  readonly id: number;
  readonly hex: HexId;
  /** Солдат в отряде, fixed-point. */
  readonly soldiers: number;
}

/** Свободный гекс с ценой приоритета: меньше — раньше (плотность, горы, тяга к цели). */
export interface ExpansionCell {
  readonly hex: HexId;
  readonly cost: number;
  /** Гекс далёк от чужих отрядов: сюда можно отправить мелкую часть, не рискуя ею. */
  readonly safe: boolean;
}

/** Решение по отряду: куда идёт он сам и какие части (солдат, гекс) отделяет на другие гексы. */
export interface ExpansionOrder {
  readonly unitId: number;
  readonly main: HexId | null;
  readonly parts: readonly { readonly soldiers: number; readonly hex: HexId }[];
}

/** Вес расстояния против цены приоритета гекса: лишний гекс пути стоит столько же, сколько это число. */
const DISTANCE_WEIGHT = 2;
/** Сколько ближайших гексов рассматривается на отряд — предел размера перебора. */
const NEAREST_CELLS = 10;
/** Как далеко от отряда отделяется часть на соседний гекс, гексов: дальше идёт целый отряд. */
const SPLIT_REACH = 4;

interface Pair {
  readonly unit: number;
  readonly cell: number;
  readonly cost: number;
}

/**
 * Раздаёт гексы отрядам. Сначала каждый отряд получает лучший для него гекс (глобально выгоднее —
 * раньше), затем оставшиеся безопасные гексы раздаются частями: отряд делится поровну на
 * «себя + части», каждая часть не меньше `minPart`.
 * @param units свободные отряды
 * @param cells незанятые ничьи гексы
 * @param dist расстояние между гексами в гексах
 * @param minPart наименьшая часть при делении, fixed-point
 * @returns приказы по отрядам, которым что-то досталось, в порядке id
 */
export function planExpansion(
  units: readonly ExpansionUnit[],
  cells: readonly ExpansionCell[],
  dist: (a: HexId, b: HexId) => number,
  minPart: number,
): ExpansionOrder[] {
  const pairs: Pair[] = [];
  units.forEach((u, ui) => {
    const near = cells
      .map((c, ci) => ({ ci, cost: dist(u.hex, c.hex) * DISTANCE_WEIGHT + c.cost }))
      .sort((a, b) => a.cost - b.cost || (cells[a.ci]?.hex ?? 0) - (cells[b.ci]?.hex ?? 0))
      .slice(0, NEAREST_CELLS);
    for (const n of near) pairs.push({ unit: ui, cell: n.ci, cost: n.cost });
  });
  pairs.sort(
    (a, b) =>
      a.cost - b.cost ||
      (units[a.unit]?.id ?? 0) - (units[b.unit]?.id ?? 0) ||
      (cells[a.cell]?.hex ?? 0) - (cells[b.cell]?.hex ?? 0),
  );
  const mainOf = new Map<number, number>();
  const usedCell = new Set<number>();
  for (const p of pairs) {
    if (mainOf.has(p.unit) || usedCell.has(p.cell)) continue;
    mainOf.set(p.unit, p.cell);
    usedCell.add(p.cell);
  }
  // Оставшиеся безопасные гексы — частями от ближайших крупных отрядов.
  const extras = new Map<number, number[]>();
  const room = (ui: number): number =>
    intDiv(units[ui]?.soldiers ?? 0, minPart) - 1 - (extras.get(ui)?.length ?? 0);
  const left = cells
    .map((c, ci) => ({ c, ci }))
    .filter(({ c, ci }) => c.safe && !usedCell.has(ci))
    .sort((a, b) => a.c.cost - b.c.cost || a.c.hex - b.c.hex);
  for (const { c, ci } of left) {
    let best = -1;
    let bestD = SPLIT_REACH + 1;
    units.forEach((u, ui) => {
      const main = mainOf.get(ui);
      // Делится только отряд, идущий на безопасный гекс: у врага мелкие части гибнут.
      if (main === undefined || !cells[main]?.safe || room(ui) <= 0) return;
      const d = dist(u.hex, c.hex);
      if (d < bestD || (d === bestD && best >= 0 && u.id < (units[best]?.id ?? 0))) {
        best = ui;
        bestD = d;
      }
    });
    if (best < 0) continue;
    extras.set(best, [...(extras.get(best) ?? []), ci]);
    usedCell.add(ci);
  }
  const out: ExpansionOrder[] = [];
  units.forEach((u, ui) => {
    const main = mainOf.get(ui);
    if (main === undefined) return;
    const more = extras.get(ui) ?? [];
    // Часть — целое число солдат: деление отряда в игре идёт целыми солдатами.
    const part = more.length === 0 ? 0 : intDiv(intDiv(u.soldiers, more.length + 1), FP) * FP;
    out.push({
      unitId: u.id,
      main: cells[main]?.hex ?? null,
      parts: more.map((ci) => ({ soldiers: part, hex: cells[ci]?.hex ?? 0 })),
    });
  });
  return out.sort((a, b) => a.unitId - b.unitId);
}
