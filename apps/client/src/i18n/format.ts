// Числа интерфейса по языку: «12 400», «1,2», «+38/с» (ui.md, HUD).
import { lang, t } from './dict.ts';

const FP = 1000;
const locale = lang === 'ru' ? 'ru-RU' : 'en-US';

/** Fixed-point → число с заданным числом знаков после запятой. */
export function formatFp(fp: number, digits = 0): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fp / FP);
}

/** Скорость со знаком: «+1,2/с», «−0,6/с». */
export function formatRate(fpPerS: number, digits = 1): string {
  const sign = fpPerS > 0 ? '+' : fpPerS < 0 ? '−' : '';
  return `${sign}${formatFp(Math.abs(fpPerS), digits)}${t('hud.perSecond')}`;
}

/** Доля fixed-point (200 = 20 %) → «20 %». */
export function formatPercent(fp: number): string {
  return `${Math.round((fp / FP) * 100)} %`;
}

/** Множитель fixed-point → «×0,5». */
export function formatMult(fp: number): string {
  return `×${formatFp(fp, fp % 100 === 0 ? 1 : 2)}`;
}

/** Время матча по тику (10 тиков/с) → «07:42». */
export function formatClock(tick: number, ticksPerS: number): string {
  const s = Math.floor(tick / ticksPerS);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
