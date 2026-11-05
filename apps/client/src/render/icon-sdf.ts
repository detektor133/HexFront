// Поле расстояний (SDF) для иконок на карте: растр фигуры → расстояние со знаком до границы.
// Видеокарта по этому полю рисует край иконки гладким при любом зуме, без мыла растровых текстур.
const INF = 1e20;

// Одномерное преобразование расстояний Фельценшвальба — Хаттенлохера (квадрат расстояния).
function transform1d(
  f: Float64Array,
  n: number,
  out: Float64Array,
  v: Int32Array,
  z: Float64Array,
) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  const cross = (q: number, p: number): number =>
    ((f[q] ?? 0) + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < n; q += 1) {
    let s = cross(q, v[k] ?? 0);
    while (k > 0 && s <= (z[k] ?? 0)) {
      k -= 1;
      s = cross(q, v[k] ?? 0);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while ((z[k + 1] ?? INF) < q) k += 1;
    const p = v[k] ?? 0;
    out[q] = (q - p) * (q - p) + (f[p] ?? 0);
  }
}

// Квадрат расстояния до ближайшего пикселя, где feature(x) === true.
function squaredDistance(size: number, feature: (index: number) => boolean): Float64Array {
  const grid = new Float64Array(size * size);
  for (let i = 0; i < grid.length; i += 1) grid[i] = feature(i) ? 0 : INF;
  const column = new Float64Array(size);
  const result = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) column[y] = grid[y * size + x] ?? INF;
    transform1d(column, size, result, v, z);
    for (let y = 0; y < size; y += 1) grid[y * size + x] = result[y] ?? INF;
  }
  const row = new Float64Array(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) row[x] = grid[y * size + x] ?? INF;
    transform1d(row, size, result, v, z);
    for (let x = 0; x < size; x += 1) grid[y * size + x] = result[x] ?? INF;
  }
  return grid;
}

/**
 * Поле расстояний фигуры.
 * @param inside маска size×size: 1 — пиксель внутри фигуры
 * @param size сторона маски, пикселей
 * @param spread на каком расстоянии от границы (в пикселях результата) поле перестаёт меняться
 * @param factor во сколько раз результат меньше маски (маска строится крупнее ради точности края)
 * @returns байты size/factor × size/factor: 128 — граница, больше — внутри, меньше — снаружи
 */
export function signedDistanceField(
  inside: Uint8Array,
  size: number,
  spread: number,
  factor: number,
): Uint8Array {
  const toOutside = squaredDistance(size, (i) => inside[i] === 0);
  const toInside = squaredDistance(size, (i) => inside[i] === 1);
  const out = size / factor;
  const bytes = new Uint8Array(out * out);
  for (let y = 0; y < out; y += 1) {
    for (let x = 0; x < out; x += 1) {
      // Берём центр блока factor×factor: погрешность края не больше полпикселя маски.
      const i = (y * factor + (factor >> 1)) * size + x * factor + (factor >> 1);
      const a = toOutside[i] ?? 0;
      const distance = a > 0 ? Math.sqrt(a) - 0.5 : -(Math.sqrt(toInside[i] ?? 0) - 0.5);
      const normalized = 0.5 + distance / factor / (2 * spread);
      bytes[y * out + x] = Math.round(Math.min(1, Math.max(0, normalized)) * 255);
    }
  }
  return bytes;
}
