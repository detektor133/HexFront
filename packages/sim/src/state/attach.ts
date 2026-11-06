// Привязка отрядов армии к линиям её фронта (07-controls.md, «Распределение»): у армии может быть
// несколько линий, отряд закреплён за одной и остаётся на ней, пока не нужен другой. Привязка не
// хранится отдельно — это линия, на чьём гексе стоит место отряда (`slot`); новые и бесхозные
// отряды закрепляются за линией с наибольшей нехваткой.
import type { MatchState, Unit } from './types.ts';
import { FRONT_REBALANCE_SURPLUS } from '../balance.ts';
import { distance, hexFromId, type HexId } from '../math/hex.ts';
import { FP, intDiv } from '../math/int.ts';

/**
 * Предел веса гекса при расчёте долей линий: вес врага скачет в десятки раз за секунды, а отряды
 * между линиями ходят минутами — без предела доли «качались» бы и отряды ездили между линиями.
 */
const QUOTA_WEIGHT_CAP = 3 * FP;

/**
 * Линии фронта: связные по соседству группы гексов плана, порядок гексов — как в плане.
 * @returns список линий, порядок — по первому гексу в плане
 */
export function lineRuns(state: MatchState, line: readonly HexId[]): HexId[][] {
  const { width } = state.map;
  const order = new Map(line.map((h, i) => [h, i]));
  const seen = new Set<HexId>();
  const runs: HexId[][] = [];
  for (const start of line) {
    if (seen.has(start)) continue;
    const run: HexId[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const h = queue.pop() as HexId;
      run.push(h);
      for (const other of line) {
        if (seen.has(other) || distance(hexFromId(h, width), hexFromId(other, width)) !== 1)
          continue;
        seen.add(other);
        queue.push(other);
      }
    }
    runs.push(run.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }
  return runs;
}

// Сколько отрядов должно быть на каждой линии: по весу, остаток — по большим дробным частям.
function quotas(weights: readonly number[], n: number): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return weights.map(() => 0);
  const base = weights.map((w) => intDiv(n * w, total));
  const rest = weights.map((w, i) => ({ i, rem: n * w - (base[i] ?? 0) * total }));
  rest.sort((a, b) => b.rem - a.rem || a.i - b.i);
  let left = n - base.reduce((s, b) => s + b, 0);
  for (const { i } of rest) {
    if (left <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    left -= 1;
  }
  return base;
}

function gap(state: MatchState, u: Unit, run: readonly HexId[]): number {
  const { width } = state.map;
  const at = hexFromId(u.hex, width);
  return Math.min(...run.map((h) => distance(at, hexFromId(h, width))));
}

/**
 * Делит отряды армии по линиям фронта. Отряд остаётся на своей линии; лишний отряд уходит только
 * при избытке не меньше FRONT_REBALANCE_SURPLUS на его линии и нехватке на другой — полной
 * перетасовки армии нет.
 * @returns отряды каждой линии в порядке линий
 */
export function attachUnits(
  state: MatchState,
  runs: readonly (readonly HexId[])[],
  weight: ReadonlyMap<HexId, number>,
  units: readonly Unit[],
): Unit[][] {
  const where = new Map<HexId, number>();
  runs.forEach((run, r) => run.forEach((h) => where.set(h, r)));
  const attached: Unit[][] = runs.map(() => []);
  const loose: Unit[] = [];
  for (const u of units) {
    const r = u.slot >= 0 ? where.get(u.slot) : undefined;
    if (r === undefined) loose.push(u);
    else attached[r]?.push(u);
  }
  const want = quotas(
    runs.map((run) => run.reduce((s, h) => s + Math.min(QUOTA_WEIGHT_CAP, weight.get(h) ?? 0), 0)),
    units.length,
  );
  const deficit = (r: number): number => (want[r] ?? 0) - (attached[r]?.length ?? 0);
  const neediest = (u: Unit): number => {
    let best = 0;
    for (let r = 1; r < runs.length; r += 1) {
      const d = deficit(r) - deficit(best);
      if (d > 0 || (d === 0 && gap(state, u, runs[r] ?? []) < gap(state, u, runs[best] ?? []))) {
        best = r;
      }
    }
    return best;
  };
  for (const u of loose.sort((a, b) => a.id - b.id)) attached[neediest(u)]?.push(u);
  // Перекос: избыток на одной линии и нехватка на другой — отряд ближайший к нуждающейся линии.
  // Порог растёт с войском: четверть отрядов — это уже перекос, а не колебание веса.
  const surplusMin = Math.max(FRONT_REBALANCE_SURPLUS, intDiv(units.length, 4));
  for (let r = 0; r < runs.length; r += 1) {
    while (-deficit(r) >= surplusMin) {
      const needy = runs.findIndex((_, d) => d !== r && deficit(d) >= 1);
      if (needy < 0) break;
      const from = attached[r] ?? [];
      const mover = [...from].sort(
        (a, b) =>
          gap(state, a, runs[needy] ?? []) - gap(state, b, runs[needy] ?? []) || a.id - b.id,
      )[0];
      if (!mover) break;
      from.splice(from.indexOf(mover), 1);
      attached[needy]?.push(mover);
    }
  }
  return attached;
}
