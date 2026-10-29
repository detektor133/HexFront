import { Text, type Container } from 'pixi.js';

import { hexFromId, type PlayerView } from '@hexfront/sim';

import { hexCenter } from '../render/hex-geometry.ts';
import { playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

export interface TerritoryLabel {
  readonly playerId: number;
  readonly name: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly fontSize: number;
  readonly maxWidth: number;
}

/** Возвращает по одной подписи на владельца, расположенной в центре его гексов. */
export function buildTerritoryLabels(
  view: Pick<PlayerView, 'hexes' | 'players'>,
  mapWidth: number,
  hexRadius: number,
): readonly TerritoryLabel[] {
  const sums = new Map<
    number,
    { x: number; y: number; count: number; minX: number; maxX: number }
  >();
  for (let id = 0; id < view.hexes.owner.length; id += 1) {
    const owner = view.hexes.owner[id] ?? -1;
    if (owner < 0) continue;
    const at = hexCenter(hexFromId(id, mapWidth), hexRadius);
    const sum = sums.get(owner) ?? {
      x: 0,
      y: 0,
      count: 0,
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
    };
    sum.x += at.x;
    sum.y += at.y;
    sum.count += 1;
    sum.minX = Math.min(sum.minX, at.x - hexRadius);
    sum.maxX = Math.max(sum.maxX, at.x + hexRadius);
    sums.set(owner, sum);
  }

  return view.players.flatMap((player) => {
    const sum = sums.get(player.id);
    const name = player.name ?? '';
    if (!sum || name.trim() === '') return [];
    const fontSize = Math.min(
      tokens.font.size.display,
      Math.max(tokens.font.size.caption, tokens.font.size.caption * Math.sqrt(sum.count)),
    );
    return [
      {
        playerId: player.id,
        name,
        fontSize,
        maxWidth: sum.maxX - sum.minX,
        at: { x: (sum.minX + sum.maxX) / 2, y: sum.y / sum.count },
      },
    ];
  });
}

/** Возвращает ключ для пересоздания подписей при изменении данных или масштаба. */
export function territoryLabelsKey(
  labels: readonly TerritoryLabel[],
  scale: number,
  detail: 1 | 2 | 3,
): string {
  return `${scale}|${detail}|${labels.map((label) => `${label.playerId}:${label.name}:${label.fontSize}:${label.maxWidth}:${label.at.x}:${label.at.y}`).join(',')}`;
}

/** Возвращает горизонтальный коэффициент подписи, чтобы её ширина не превышала территорию. */
export function territoryLabelWidthScale(textWidth: number, maxWidth: number): number {
  return Math.min(1, maxWidth / textWidth);
}

function measuredTextWidth(text: Text): number {
  if (
    typeof document === 'undefined' ||
    document.createElement('canvas').getContext('2d') === null
  ) {
    return text.text.length * text.style.fontSize;
  }
  return text.width;
}

/** Рисует подписи государств на первых двух уровнях детализации. */
export function drawTerritoryLabels(
  container: Container,
  labels: readonly TerritoryLabel[],
  scale: number,
  detail: 1 | 2 | 3,
): void {
  if (detail === 3) return;
  for (const label of labels) {
    const text = new Text({
      text: label.name,
      style: {
        fontFamily: tokens.font.ui.family,
        fontWeight: '400',
        fontSize: label.fontSize,
        fill: playerLine(label.playerId),
        stroke: { color: tokens.ui.surface, width: tokens.city.labelHalo },
      },
    });
    text.resolution = (globalThis.window?.devicePixelRatio ?? 1) * 2;
    text.anchor.set(0.5);
    text.scale.set(
      territoryLabelWidthScale(measuredTextWidth(text), label.maxWidth) / scale,
      1 / scale,
    );
    text.position.set(label.at.x, label.at.y);
    container.addChild(text);
  }
}
