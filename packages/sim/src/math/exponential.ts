import { POP_OVERCAP_DECAY, TICKS_PER_S } from '../balance.ts';
import { FP, intDiv, type Fp } from './int.ts';

/** Масштаб аналитических величин; точнее обычного fixed-point в 1000 раз. */
export const ANALYTIC_FP = 1_000_000;
const EXP_REDUCTION_BITS = 8;
const EXP_TERMS = 16;
const EXP_ZERO_THRESHOLD = 20 * ANALYTIC_FP;
const EXP_REDUCED_MAX = 10_000;

function scaledProduct(value: number, factor: number): number {
  const whole = intDiv(value, ANALYTIC_FP);
  const remainder = value - whole * ANALYTIC_FP;
  return whole * factor + intDiv(remainder * factor, ANALYTIC_FP);
}

function expNegReduced(argument: number, reductionBits: number): number {
  const reduced = argument >> reductionBits;
  let term = ANALYTIC_FP;
  let result = ANALYTIC_FP;
  for (let order = 1; order <= EXP_TERMS; order += 1) {
    term = intDiv(term * reduced, ANALYTIC_FP * order);
    result += order % 2 === 0 ? term : -term;
  }
  return Math.max(0, result);
}

/**
 * Вычисляет `exp(-x)` без вещественной арифметики.
 * @param argument аргумент `x`, масштаб `ANALYTIC_FP`
 * @returns множитель `exp(-x)`, масштаб `ANALYTIC_FP`
 */
export function expNegFixed(argument: number): number {
  if (!Number.isSafeInteger(argument) || argument < 0) {
    throw new RangeError(`expNegFixed: недопустимый аргумент ${argument}`);
  }
  if (argument >= EXP_ZERO_THRESHOLD) return 0;

  let reductionBits = 0;
  while (reductionBits < EXP_REDUCTION_BITS && argument >> reductionBits > EXP_REDUCED_MAX) {
    reductionBits += 1;
  }
  let result = expNegReduced(argument, reductionBits);
  for (let bit = 0; bit < reductionBits; bit += 1) {
    result = scaledProduct(result, result);
  }
  return result;
}

/**
 * Преобразует скорость роста и лимит в коэффициент `a / popCap`.
 * @returns коэффициент в секунду, масштаб `ANALYTIC_FP`
 */
export function growthRate(a: Fp, popCap: Fp): number {
  if (popCap <= 0 || a < 0) return 0;
  return intDiv(a * ANALYTIC_FP, popCap);
}

/**
 * Накапливает интеграл множителя роста налога.
 * @param taxGrowthMult множитель роста, fixed-point
 * @param ticks число тиков по 100 мс
 * @returns интеграл множителя, масштаб `ANALYTIC_FP × секунда`
 */
export function growthIntegral(taxGrowthMult: Fp, ticks: number): number {
  if (ticks < 0 || !Number.isSafeInteger(ticks)) {
    throw new RangeError(`growthIntegral: недопустимое число тиков ${ticks}`);
  }
  return intDiv(taxGrowthMult * ticks * ANALYTIC_FP, FP * TICKS_PER_S);
}

/**
 * Применяет аналитическое затухание к дефициту населения.
 * @param deficit дефицит в fixed-point людях
 * @param rate коэффициент `a / popCap`, масштаб `ANALYTIC_FP`
 * @param deltaM приращение интеграла, масштаб `ANALYTIC_FP × секунда`
 * @returns дефицит в fixed-point людях
 */
export function decayDeficit(deficit: number, rate: number, deltaM: number): number {
  if (rate < 0 || deltaM < 0) throw new RangeError('decayDeficit: отрицательное затухание');
  const argument = intDiv(rate * deltaM, ANALYTIC_FP);
  return scaledProduct(deficit, expNegFixed(argument));
}

/**
 * Применяет убыль населения сверх лимита по `POP_OVERCAP_DECAY`.
 * @param excess превышение лимита в fixed-point людях
 * @param ticks число тиков по 100 мс
 * @returns превышение лимита в fixed-point людях
 */
export function decayOvercap(excess: number, ticks: number): number {
  return decayDeficit(
    excess,
    growthRate(POP_OVERCAP_DECAY, FP as Fp),
    growthIntegral(FP as Fp, ticks),
  );
}
