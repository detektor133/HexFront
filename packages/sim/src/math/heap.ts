// Двоичная куча минимумов по (приоритет, ключ). Ключ разрешает ничьи детерминированно.

/** Куча пар «приоритет — ключ», оба целые. */
export interface MinHeap {
  readonly items: [number, number][];
}

const less = (a: [number, number], b: [number, number]): boolean =>
  a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** Пустая куча. */
export function createHeap(): MinHeap {
  return { items: [] };
}

/** Добавляет пару (приоритет, ключ). */
export function heapPush(h: MinHeap, priority: number, key: number): void {
  const a = h.items;
  a.push([priority, key]);
  let i = a.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const pi = a[parent] as [number, number];
    const ci = a[i] as [number, number];
    if (!less(ci, pi)) break;
    a[parent] = ci;
    a[i] = pi;
    i = parent;
  }
}

/**
 * Извлекает минимальную пару.
 * @returns [приоритет, ключ] или undefined для пустой кучи
 */
export function heapPop(h: MinHeap): [number, number] | undefined {
  const a = h.items;
  const top = a[0];
  const last = a.pop();
  if (!top || !last || a.length === 0) return top;
  a[0] = last;
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    if (l < a.length && less(a[l] as [number, number], a[m] as [number, number])) m = l;
    if (r < a.length && less(a[r] as [number, number], a[m] as [number, number])) m = r;
    if (m === i) break;
    const tmp = a[m] as [number, number];
    a[m] = a[i] as [number, number];
    a[i] = tmp;
    i = m;
  }
  return top;
}
