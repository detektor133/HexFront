// Рисование маршрута (07-controls.md, «Маршрут по точкам»): путь со стрелкой, точки маршрута и
// плашка со временем «м:сс»; конец красный, если на пути виден враг.
import { BitmapText, Container, Graphics } from 'pixi.js';

import type { RouteView } from './route-draft.ts';
import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

const LINE_PX = 3;
const DOT_PX = 4;
const ARROW_PX = 9;
const TEXT_PX = 12;
const PAD_X = 6;
const HEIGHT = 22;
const RADIUS = 6;
const LIFT_PX = 30;
const TICKS_PER_SECOND = 10;

/** Время в пути «м:сс» по тикам sim (10 тиков в секунду). */
export function formatTravel(ticks: number): string {
  const total = Math.ceil(ticks / TICKS_PER_SECOND);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Рисует маршрут в marks и плашку времени в plates.
 * @param k мировых единиц на пиксель экрана (1 / масштаб)
 */
export function drawRoute(
  marks: Graphics,
  plates: Container,
  route: RouteView,
  center: (hex: number) => Point,
  k: number,
): void {
  const pts = route.path.map(center);
  if (pts.length === 0) return;
  const danger = route.enemyOnPath;
  const color = danger ? tokens.status.danger : tokens.ui.ink;
  const body = pts.length > 1 ? pts : [];
  if (body.length > 0) {
    marks.moveTo((body[0] as Point).x, (body[0] as Point).y);
    for (const p of body.slice(1)) marks.lineTo(p.x, p.y);
    marks.stroke({ color, width: LINE_PX * k, cap: 'round', join: 'round', alpha: 0.85 });
  }
  for (const hex of route.waypoints.slice(0, -1)) {
    const p = center(hex);
    marks
      .circle(p.x, p.y, DOT_PX * k)
      .fill(tokens.ui.surface)
      .stroke({ color, width: 2 * k });
  }
  const end = pts[pts.length - 1] as Point;
  const prev = pts.length > 1 ? (pts[pts.length - 2] as Point) : end;
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
  const a = ARROW_PX * k;
  const wing = (turn: number): Point => ({
    x: end.x - a * Math.cos(angle + turn),
    y: end.y - a * Math.sin(angle + turn),
  });
  const left = wing(0.5);
  const right = wing(-0.5);
  marks
    .moveTo(left.x, left.y)
    .lineTo(end.x, end.y)
    .lineTo(right.x, right.y)
    .stroke({ color, width: LINE_PX * k, cap: 'round', join: 'round' });

  const text = new BitmapText({
    text: formatTravel(route.ticks),
    style: {
      fontFamily: tokens.font.ui.family,
      fontWeight: '500',
      fontSize: TEXT_PX,
      fill: tokens.ui.ink,
    },
  });
  text.resolution = window.devicePixelRatio * 2;
  const w = PAD_X * 2 + text.width;
  const g = new Graphics();
  g.roundRect(-w / 2, -HEIGHT, w, HEIGHT, RADIUS)
    .fill(tokens.ui.surface)
    .stroke({ color, width: 1.2 });
  text.anchor.set(0.5, 0.5);
  text.position.set(0, -HEIGHT / 2);
  const plate = new Container();
  plate.addChild(g, text);
  plate.scale.set(k);
  plate.position.set(end.x, end.y - LIFT_PX * k);
  plates.addChild(plate);
}
