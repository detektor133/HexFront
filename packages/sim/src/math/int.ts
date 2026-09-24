// Целочисленная арифметика и fixed-point: единственное место sim с делением и усечением.
// Архитектура: docs/architecture/sim-core.md — «Fixed-point».

/** Масштаб fixed-point: 1.0 = 1000. */
export const FP = 1000;

/** Число в fixed-point (×1000). Брендированный тип не даёт смешать его с обычным целым. */
export type Fp = number & { readonly __fp: true };

/**
 * Константа fixed-point из десятичного литерала. Только для констант баланса при загрузке модуля:
 * округление до ближайшего нужно, потому что 1.005 * 1000 во float даёт 1004.999….
 * @returns fixed-point (1000 = 1,0)
 */
export function fp(value: number): Fp {
  const raw = Math.trunc(value * FP + (value >= 0 ? 0.5 : -0.5));
  if (!Number.isSafeInteger(raw)) throw new RangeError(`fp: значение вне диапазона: ${value}`);
  return raw as Fp;
}

/**
 * Целочисленное деление с усечением к нулю.
 * @returns целое частное
 */
export function intDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('intDiv: деление на ноль');
  // `+ 0` превращает -0 в 0: иначе хэш состояния мог бы различаться.
  return Math.trunc(a / b) + 0;
}

/**
 * Целочисленное деление с округлением вниз (к −∞); нужно для округления координат.
 * @returns целое частное
 */
export function floorDiv(a: number, b: number): number {
  const q = intDiv(a, b);
  return q * b !== a && a < 0 !== b < 0 ? q - 1 : q;
}

/**
 * Произведение двух fixed-point: `intDiv(a * b, FP)`.
 * Безопасно, пока |a·b| ≤ 2⁵³ (население и солдаты ≤ 10⁷ единиц).
 * @returns fixed-point
 */
export function fpMul(a: Fp, b: Fp): Fp {
  return intDiv(a * b, FP) as Fp;
}

/**
 * Частное двух fixed-point: `intDiv(a * FP, b)`.
 * @returns fixed-point
 */
export function fpDiv(a: Fp, b: Fp): Fp {
  return intDiv(a * FP, b) as Fp;
}

/**
 * Ограничение значения отрезком [min, max]; сохраняет брендированный тип.
 * @returns значение в пределах [min, max]
 */
export function clamp<T extends number>(value: T, min: T, max: T): T {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
