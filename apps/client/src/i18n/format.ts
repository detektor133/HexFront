// Числа интерфейса по языку: «12 400», «1,2», «+38/с» (ui.md, HUD).
import { lang, t } from './dict.ts';

const FP = 1000;
const locale = lang === 'ru' ? 'ru-RU' : 'en-US';

/** Fixed-point → число с заданным числом знаков после запятой. */
export function formatFp(fp: number, digits = 0): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .formatToParts(fp / FP)
    .map((part) => (part.type === 'group' ? ' ' : part.value))
    .join('');
}

/** Fixed-point число в компактном локализованном формате HUD. */
export function formatCompact(fp: number): string {
  const n = Math.floor(fp / FP);
  const thousand = t('unit.thousandSuffix');
  const million = t('unit.millionSuffix');
  if (n < THOUSAND) {
    if (Math.round(fp / FP) >= THOUSAND) return formatFp(THOUSAND * FP);
    return formatFp(fp, fp / FP < 10 && !Number.isInteger(fp / FP) ? 1 : 0);
  }
  if (n < TEN_THOUSAND) {
    const tenths = Math.floor(n / (THOUSAND / 10)) / 10;
    return `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(tenths)}${thousand}`;
  }
  if (n < MILLION) {
    return `${Math.floor(n / THOUSAND)}${thousand}`;
  }
  const tenths = Math.round((n / MILLION) * 10) / 10;
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(tenths)}${million}`;
}

/** Скорость со знаком: «+1,2/с», «−0,6/с». */
export function formatRate(fpPerS: number): string {
  const sign = fpPerS > 0 ? '+' : fpPerS < 0 ? '−' : '';
  return `${sign}${formatCompact(Math.abs(fpPerS))}${t('hud.perSecond')}`;
}

/** Fixed-point скорость с полным локализованным числом для подсказки HUD. */
export function formatRateFull(fpPerS: number): string {
  const sign = fpPerS > 0 ? '+' : fpPerS < 0 ? '−' : '';
  return `${sign}${formatFp(Math.abs(fpPerS))}${t('hud.perSecond')}`;
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

const THOUSAND = 1000;
const TEN_THOUSAND = 10_000;
const MILLION = 1_000_000;

/**
 * Солдаты на фишке (units.md, «Формат числа»): «850», «1,4к», «12к»; округление вниз —
 * показываем не больше, чем есть.
 */
export function formatSoldiers(fp: number): string {
  const n = Math.floor(fp / FP);
  const k = t('unit.thousandSuffix');
  if (n < THOUSAND) return String(n);
  if (n < TEN_THOUSAND) {
    const tenths = Math.floor(n / (THOUSAND / 10)) / 10;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(tenths)}${k}`;
  }
  return `${Math.floor(n / THOUSAND)}${k}`;
}
