import { Graphics, Text, type Container } from 'pixi.js';

import { hexFromId, type PlayerView, type TreatyKind } from '@hexfront/sim';

import { hexCenter } from '../render/hex-geometry.ts';
import { playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

export interface TerritoryLabel {
  readonly playerId: number;
  readonly name: string;
  readonly at: { readonly x: number; readonly y: number };
  readonly fontSize: number;
  readonly maxWidth: number;
  /** Отношение к игроку-зрителю: значок под названием; null — мир или свой (CR-007). */
  readonly relation: 'war' | 'pact' | 'defense' | 'alliance' | null;
  /** Входящее предложение от этого государства: значок предложенного договора. */
  readonly offer: TreatyKind | null;
}

/** Возвращает по одной подписи на владельца, расположенной в центре его гексов. */
export function buildTerritoryLabels(
  view: Pick<PlayerView, 'hexes' | 'players' | 'diplomacy' | 'playerId'>,
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
        relation: relationOfLabel(view, player.id),
        offer: view.diplomacy?.incoming.find((o) => o.from === player.id)?.kind ?? null,
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
  return `${scale}|${detail}|${labels.map((label) => `${label.playerId}:${label.name}:${label.fontSize}:${label.maxWidth}:${label.relation}:${label.offer}:${label.at.x}:${label.at.y}`).join(',')}`;
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

/** Шаг размера шрифта подписи, px: подписи в одном шаге делят одну текстуру (память GPU). */
const FONT_STEP = 2;

interface LabelState {
  readonly texts: Map<string, Text>;
  glyphs: Graphics[];
}

const labelStates = new WeakMap<Container, LabelState>();

/**
 * Рисует подписи государств на первых двух уровнях детализации. Тексты переиспользуются между
 * перерисовками (ключ: игрок, имя, шаг размера), а точный размер добирается масштабом: рост
 * территории не плодит новые текстуры.
 */
export function drawTerritoryLabels(
  container: Container,
  labels: readonly TerritoryLabel[],
  scale: number,
  detail: 1 | 2 | 3,
): void {
  const state = labelStates.get(container) ?? { texts: new Map<string, Text>(), glyphs: [] };
  labelStates.set(container, state);
  for (const g of state.glyphs) g.destroy();
  state.glyphs = [];
  const keep = new Set<string>();
  for (const label of detail === 3 ? [] : labels) {
    const size = Math.max(FONT_STEP, Math.round(label.fontSize / FONT_STEP) * FONT_STEP);
    const key = `${label.playerId}|${label.name}|${size}`;
    keep.add(key);
    let text = state.texts.get(key);
    if (!text) {
      text = new Text({
        text: label.name,
        style: {
          fontFamily: tokens.font.ui.family,
          fontWeight: '400',
          fontSize: size,
          fill: playerLine(label.playerId),
          stroke: { color: tokens.ui.surface, width: tokens.city.labelHalo },
        },
      });
      text.resolution = (globalThis.window?.devicePixelRatio ?? 1) * 2;
      text.anchor.set(0.5);
      state.texts.set(key, text);
      container.addChild(text);
    }
    const extra = label.fontSize / size;
    text.scale.set(
      (territoryLabelWidthScale(measuredTextWidth(text) * extra, label.maxWidth) * extra) / scale,
      extra / scale,
    );
    text.position.set(label.at.x, label.at.y);
  }
  for (const [key, text] of state.texts) {
    if (keep.has(key)) continue;
    container.removeChild(text);
    text.destroy();
    state.texts.delete(key);
  }
  for (const label of detail === 3 ? [] : labels) {
    // Предложение мира рисуется значком пакта: отдельного значка у мира нет.
    const glyph = label.offer === 'peace' ? 'pact' : (label.offer ?? label.relation);
    if (glyph === null) continue;
    const color =
      label.offer !== null
        ? tokens.status.warning
        : label.relation === 'war'
          ? tokens.status.danger
          : label.relation === 'alliance'
            ? tokens.relation.ally
            : tokens.ui.ink2;
    const below = { x: label.at.x, y: label.at.y + (label.fontSize * 0.5 + 9) / scale };
    state.glyphs.push(drawRelationGlyph(container, glyph, below, scale, color));
  }
}

function relationOfLabel(
  view: Pick<PlayerView, 'diplomacy' | 'playerId'>,
  playerId: number,
): TerritoryLabel['relation'] {
  if (playerId === view.playerId) return null;
  const relation = view.diplomacy?.relations[playerId];
  return relation === 'war' ||
    relation === 'pact' ||
    relation === 'defense' ||
    relation === 'alliance'
    ? relation
    : null;
}

/** Значок отношения 12 px под названием: война — скрещённые линии, пакт — кружок с чертой, оборонительный пакт — кружок с вертикалью, альянс — два кольца. */
function drawRelationGlyph(
  container: Container,
  kind: 'war' | 'pact' | 'defense' | 'alliance',
  at: { readonly x: number; readonly y: number },
  scale: number,
  color: string,
): Graphics {
  const g = new Graphics();
  const draw = (stroke: { color: string; width: number }): void => {
    if (kind === 'war') {
      g.moveTo(-5, -5).lineTo(5, 5).moveTo(5, -5).lineTo(-5, 5);
    } else if (kind === 'pact') {
      g.circle(0, 0, 5).moveTo(-3, 0).lineTo(3, 0);
    } else if (kind === 'defense') {
      g.circle(0, 0, 5).moveTo(0, -3).lineTo(0, 3);
    } else {
      g.circle(-3, 0, 4).circle(3, 0, 4);
    }
    g.stroke({ ...stroke, cap: 'round' });
  };
  draw({ color: tokens.ui.surface, width: 4.5 });
  draw({ color, width: 2 });
  g.scale.set(1 / scale);
  g.position.set(at.x, at.y);
  container.addChild(g);
  return g;
}
