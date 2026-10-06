// Плашка прогноза боя без слов (art/units.md, «Плашка прогноза»): иконка и цвет исхода + свои потери
// «−28 %». Видна при наведении на вражеский гекс (ПК), пока палец держит его (телефон) и у линии
// наступления. Иконки исхода — свои по сетке 14×14, линия 2, round; форма — на утверждение
// владельцу (04/T16).
import { Container, Graphics, Text } from 'pixi.js';

import type { Forecast, ForecastOutcome } from '@hexfront/sim';

import { OUTCOME_ICON } from './forecast-icons.ts';
import { formatPercent } from '../i18n/format.ts';
import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

/** Что показывает плашка: иконка исхода, её цвет и свои потери. */
export interface ForecastBadge {
  readonly icon: ForecastOutcome;
  readonly color: string;
  /** Свои потери: «−28 %» (минус — типографский). */
  readonly text: string;
}

const COLOR: Record<ForecastOutcome, string> = {
  victory: tokens.status.success,
  stalemate: tokens.status.warning,
  defeat: tokens.status.danger,
};

/** Плашка прогноза по результату forecastBattle. */
export function forecastBadge(f: Forecast): ForecastBadge {
  return { icon: f.outcome, color: COLOR[f.outcome], text: `−${formatPercent(f.attackerLoss)}` };
}

/** Размеры плашки, px экрана. */
const ICON_PX = 14;
const TEXT_PX = 12;
const PAD_X = 6;
const GAP = 4;
const HEIGHT = 22;
const RADIUS = 6;
const BORDER = 1.2;
/** Жёсткая тень `shadow.hard`: сдвиг вниз 2 px, без размытия. */
const SHADOW_DY = 2;
const SHADOW_ALPHA = 0.14;

/**
 * Рисует плашку в container (очищать снаружи): низ плашки — над точкой at на lift px экрана.
 * @param k мировых единиц на пиксель экрана (1 / масштаб)
 */
export function drawForecastPlate(
  container: Container,
  badge: ForecastBadge,
  at: Point,
  k: number,
  lift = 16,
): void {
  const text = new Text({
    text: badge.text,
    style: {
      fontFamily: tokens.font.ui.family,
      fontWeight: '500',
      fontSize: TEXT_PX,
      fill: tokens.ui.ink,
    },
  });
  text.resolution = window.devicePixelRatio * 2;
  const w = PAD_X + ICON_PX + GAP + text.width + PAD_X;
  const g = new Graphics();
  g.context.batchMode = 'batch';
  const x0 = -w / 2;
  const y0 = -HEIGHT;
  g.roundRect(x0, y0 + SHADOW_DY, w, HEIGHT, RADIUS).fill({
    color: tokens.ui.ink,
    alpha: SHADOW_ALPHA,
  });
  g.roundRect(x0, y0, w, HEIGHT, RADIUS)
    .fill(tokens.ui.surface)
    .stroke({ color: badge.color, width: BORDER });
  const ix = x0 + PAD_X;
  const iy = y0 + (HEIGHT - ICON_PX) / 2;
  for (const line of OUTCOME_ICON[badge.icon]) {
    for (let i = 0; i + 1 < line.length; i += 2) {
      const px = ix + (line[i] as number);
      const py = iy + (line[i + 1] as number);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  }
  g.stroke({ color: badge.color, width: 2, cap: 'round', join: 'round' });
  text.anchor.set(0, 0.5);
  text.position.set(ix + ICON_PX + GAP, y0 + HEIGHT / 2);
  const plate = new Container();
  plate.addChild(g, text);
  plate.scale.set(k);
  plate.position.set(at.x, at.y - lift * k);
  container.addChild(plate);
}
