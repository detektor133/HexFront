// Камера карты: плавный масштаб, границы, уровни детализации, инерция.
// Правила: docs/art/style-guide.md, принцип 6; числа — map.zoom в tokens.json.
import type { Rect } from './hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

/** Экран = мир × scale + (x, y). */
export interface Camera {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export type DetailLevel = 1 | 2 | 3;

export interface Velocity {
  readonly vx: number;
  readonly vy: number;
}

const [Z2_FROM, Z3_FROM] = tokens.map.zoom.detailThresholds;
export const MAX_SCALE = tokens.map.zoom.max;

// Настройки ощущения ввода, а не визуального стиля: в токенах их нет.
/** Доля скорости, остающаяся через 1 с после отпускания. */
const INERTIA_KEEP_PER_S = 0.02;
/** Скорость ниже этой (px/с) считается остановкой. */
const INERTIA_STOP_PX_S = 5;
/** Изменение масштаба на одно «деление» колеса (deltaY = 100). */
const WHEEL_ZOOM_PER_100 = 1.2;

/** Уровень детализации по масштабу: z1 < 0,6 ≤ z2 < 1,5 ≤ z3. */
export function detailLevel(scale: number): DetailLevel {
  if (scale < Z2_FROM) return 1;
  if (scale < Z3_FROM) return 2;
  return 3;
}

/** Минимальный масштаб — вся карта на экране (но не больше максимального). */
export function minScale(view: Viewport, world: Rect): number {
  return Math.min(view.width / world.width, view.height / world.height, MAX_SCALE);
}

function clampAxis(
  offset: number,
  worldStart: number,
  worldSize: number,
  viewSize: number,
  scale: number,
): number {
  const size = worldSize * scale;
  // Карта меньше экрана — центрируем, иначе не даём увести край карты внутрь экрана.
  if (size <= viewSize) return (viewSize - size) / 2 - worldStart * scale;
  const max = -worldStart * scale;
  const min = viewSize - (worldStart + worldSize) * scale;
  return Math.min(max, Math.max(min, offset));
}

/** Приводит камеру к допустимому масштабу и границам карты. */
export function clampCamera(cam: Camera, view: Viewport, world: Rect): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(minScale(view, world), cam.scale));
  return {
    scale,
    x: clampAxis(cam.x, world.x, world.width, view.width, scale),
    y: clampAxis(cam.y, world.y, world.height, view.height, scale),
  };
}

/** Камера, показывающая всю карту. */
export function fitCamera(view: Viewport, world: Rect): Camera {
  return clampCamera({ scale: minScale(view, world), x: 0, y: 0 }, view, world);
}

/** Масштаб с неподвижной экранной точкой (курсор, центр щипка). */
export function zoomAt(
  cam: Camera,
  factor: number,
  sx: number,
  sy: number,
  view: Viewport,
  world: Rect,
): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(minScale(view, world), cam.scale * factor));
  const k = scale / cam.scale;
  return clampCamera({ scale, x: sx - (sx - cam.x) * k, y: sy - (sy - cam.y) * k }, view, world);
}

/** Множитель масштаба для события колеса. */
export function wheelFactor(deltaY: number): number {
  return WHEEL_ZOOM_PER_100 ** (-deltaY / 100);
}

/** Сдвиг камеры на экранный вектор. */
export function panBy(cam: Camera, dx: number, dy: number, view: Viewport, world: Rect): Camera {
  return clampCamera({ ...cam, x: cam.x + dx, y: cam.y + dy }, view, world);
}

/** Затухание инерции за dtMs; null — движение закончилось. */
export function decayVelocity(v: Velocity, dtMs: number): Velocity | null {
  const keep = INERTIA_KEEP_PER_S ** (dtMs / 1000);
  const next = { vx: v.vx * keep, vy: v.vy * keep };
  return Math.hypot(next.vx, next.vy) < INERTIA_STOP_PX_S ? null : next;
}
