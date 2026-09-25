// Команда setTax: ползунок налога 0–40 % с шагом 5 %. GDD: docs/gdd/02-economy.md — «Налог».
import { TAX_MAX, TAX_MIN, TAX_STEP } from '../balance.ts';
import { OK, rejected, type Validation } from './types.ts';
import type { Fp } from '../math/int.ts';

/**
 * Проверяет ставку налога.
 * @param rate доля в fixed-point (200 = 20 %)
 * @returns OK или отказ invalidTaxRate
 */
export function validateSetTax(rate: Fp): Validation {
  const valid =
    Number.isSafeInteger(rate) && rate >= TAX_MIN && rate <= TAX_MAX && rate % TAX_STEP === 0;
  return valid ? OK : rejected('invalidTaxRate');
}
