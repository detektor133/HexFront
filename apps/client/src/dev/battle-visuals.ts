import { tokens } from '../theme/tokens.ts';

const BATTLE_PULSE_MS = 800;
const BATTLE_PULSE_SHARE = 0.15;
const CITY_FLASH_PULSES = 2;
const ENCIRCLED_DASH_SPEED = 1;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Масштаб маркера боя; при reduced motion пульсация заменяется постоянным размером. */
export function battlePulseScale(nowMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return 1 + BATTLE_PULSE_SHARE * (0.5 + 0.5 * Math.sin((2 * Math.PI * nowMs) / BATTLE_PULSE_MS));
}

/** Доля заполнения захватываемого гекса за время анимации из токенов. */
export function captureProgress(elapsedMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  return clamp01(elapsedMs / tokens.motion.capture);
}

/** Прозрачность вспышки города: два пульса за длительность захвата. */
export function cityFlashAlpha(elapsedMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const progress = clamp01(elapsedMs / tokens.motion.capture);
  return 0.5 + 0.5 * Math.sin(progress * Math.PI * CITY_FLASH_PULSES * 2);
}

/** Фаза пунктира контура котла; движение отключается для reduced motion. */
export function encircledDashOffset(nowMs: number, period: number, reducedMotion: boolean): number {
  if (reducedMotion || period <= 0) return 0;
  return Math.floor((nowMs / 1000) * ENCIRCLED_DASH_SPEED) % period;
}
