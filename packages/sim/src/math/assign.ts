// Оптимальное назначение «строка — столбец» с наименьшей суммой стоимостей (венгерский алгоритм,
// только целые числа — результат детерминирован и участвует в состоянии матча).

/**
 * Назначает каждой строке свой столбец так, чтобы сумма стоимостей была наименьшей. Строк не
 * больше столбцов; при равной сумме порядок обхода делает результат одинаковым на любой машине.
 * @param cost матрица стоимостей cost[строка][столбец], целые числа
 * @returns для каждой строки номер её столбца
 */
export function minCostAssignment(cost: readonly (readonly number[])[]): number[] {
  const rows = cost.length;
  const cols = cost[0]?.length ?? 0;
  if (rows === 0 || cols < rows) return [];
  const u = new Array<number>(rows + 1).fill(0);
  const v = new Array<number>(cols + 1).fill(0);
  const matched = new Array<number>(cols + 1).fill(0);
  const way = new Array<number>(cols + 1).fill(0);
  for (let i = 1; i <= rows; i += 1) {
    matched[0] = i;
    let j0 = 0;
    const slack = new Array<number>(cols + 1).fill(Number.MAX_SAFE_INTEGER);
    const used = new Array<boolean>(cols + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = matched[j0] as number;
      let delta = Number.MAX_SAFE_INTEGER;
      let j1 = 0;
      for (let j = 1; j <= cols; j += 1) {
        if (used[j]) continue;
        const reduced = (cost[i0 - 1]?.[j - 1] ?? 0) - (u[i0] as number) - (v[j] as number);
        if (reduced < (slack[j] as number)) {
          slack[j] = reduced;
          way[j] = j0;
        }
        if ((slack[j] as number) < delta) {
          delta = slack[j] as number;
          j1 = j;
        }
      }
      for (let j = 0; j <= cols; j += 1) {
        if (used[j]) {
          const o = matched[j] as number;
          u[o] = (u[o] as number) + delta;
          v[j] = (v[j] as number) - delta;
        } else {
          slack[j] = (slack[j] as number) - delta;
        }
      }
      j0 = j1;
    } while (matched[j0] !== 0);
    do {
      const prev = way[j0] as number;
      matched[j0] = matched[prev] as number;
      j0 = prev;
    } while (j0 !== 0);
  }
  const out = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= cols; j += 1) {
    const o = matched[j] as number;
    if (o > 0) out[o - 1] = j - 1;
  }
  return out;
}
