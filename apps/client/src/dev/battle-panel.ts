// Панель боя при наведении на маркер (art/units.md, «Панель боя»): две стороны — рода войск,
// число солдат, организация и преимущество полосками. Только видимые игроку отряды: снимок
// `PlayerView` туманом уже отфильтрован.
import { BitmapText, Container, Graphics } from 'pixi.js';

import { FP, ORG_MAX, type PlayerView, type UnitType } from '@hexfront/sim';

import { drawTypeGlyph } from './unit-chips.ts';
import type { Point } from '../render/hex-geometry.ts';
import { tokens } from '../theme/tokens.ts';

export interface BattleSide {
  /** Роды войск стороны без повторов в порядке пехота, броня, артиллерия. */
  readonly types: readonly UnitType[];
  readonly soldiers: number;
  /** Средняя организация сторон, доля 0–1. */
  readonly org: number;
}

export interface BattleSides {
  readonly attackers: BattleSide;
  readonly defenders: BattleSide;
  /** Доля организации атакующих в сумме обеих сторон, 0–1 (0,5 при пустых). */
  readonly advantage: number;
}

const TYPE_ORDER: readonly UnitType[] = ['infantry', 'armor', 'artillery'];

function side(units: readonly PlayerView['units'][number][]): BattleSide {
  const org = units.reduce((sum, u) => sum + u.org, 0);
  return {
    types: TYPE_ORDER.filter((type) => units.some((u) => u.type === type)),
    soldiers: Math.round(units.reduce((sum, u) => sum + u.soldiers, 0) / FP),
    org: units.length === 0 ? 0 : org / units.length / ORG_MAX,
  };
}

/** Состав сторон боя «источник → цель»: атакующие с приказом на цель и отряды в целевом гексе. */
export function battleSides(view: PlayerView, targetHex: number): BattleSides {
  const attackers = view.units.filter((u) => u.order === 'attack' && u.target === targetHex);
  const owners = new Set(attackers.map((u) => u.owner));
  const defenders = view.units.filter((u) => u.hex === targetHex && !owners.has(u.owner));
  const a = attackers.reduce((sum, u) => sum + u.org, 0);
  const d = defenders.reduce((sum, u) => sum + u.org, 0);
  return {
    attackers: side(attackers),
    defenders: side(defenders),
    advantage: a + d === 0 ? 0.5 : a / (a + d),
  };
}

/** Центр маркера боя на карте. */
export interface MarkerAnchor {
  readonly sourceHex: number;
  readonly targetHex: number;
  readonly at: Point;
}

/** Маркер под мировой точкой (радиус — в мировых единицах) или null. */
export function markerAt(
  anchors: Iterable<MarkerAnchor>,
  world: Point,
  radius: number,
): MarkerAnchor | null {
  let best: { a: MarkerAnchor; d: number } | null = null;
  for (const a of anchors) {
    const d = Math.hypot(world.x - a.at.x, world.y - a.at.y);
    if (d <= radius && (!best || d < best.d)) best = { a, d };
  }
  return best?.a ?? null;
}

const ROW_H = 22;
const PAD = 8;
const GLYPH = 14;
const BAR_W = 44;
const BAR_H = 4;
const TEXT_PX = 12;
const RADIUS = 6;
const LIFT_PX = 22;
const WIDTH = 150;

function row(parent: Container, y: number, s: BattleSide, color: string): void {
  const g = new Graphics();
  g.context.batchMode = 'batch';
  let x = PAD;
  for (const type of s.types) {
    drawTypeGlyph(g, type, x, y + (ROW_H - GLYPH) / 2, color);
    x += GLYPH + 2;
  }
  const text = new BitmapText({
    text: String(s.soldiers),
    style: {
      fontFamily: tokens.font.ui.family,
      fontWeight: '500',
      fontSize: TEXT_PX,
      fill: tokens.ui.ink,
    },
  });
  text.resolution = window.devicePixelRatio * 2;
  text.anchor.set(0, 0.5);
  text.position.set(PAD + 3 * (GLYPH + 2) + 2, y + ROW_H / 2);
  const barX = WIDTH - PAD - BAR_W;
  g.roundRect(barX, y + (ROW_H - BAR_H) / 2, BAR_W, BAR_H, 2).fill(tokens.chip.track);
  g.roundRect(barX, y + (ROW_H - BAR_H) / 2, Math.max(2, BAR_W * s.org), BAR_H, 2).fill(
    tokens.chip.org,
  );
  parent.addChild(g, text);
}

/**
 * Рисует панель над точкой at (низ панели на LIFT_PX выше неё).
 * @param k мировых единиц на пиксель экрана (1 / масштаб)
 */
export function drawBattlePanel(
  container: Container,
  sides: BattleSides,
  at: Point,
  k: number,
): void {
  const height = ROW_H * 2 + BAR_H + PAD * 2;
  const panel = new Container();
  const bg = new Graphics();
  bg.roundRect(-WIDTH / 2, -height, WIDTH, height, RADIUS)
    .fill(tokens.ui.surface)
    .stroke({ color: tokens.ui.ink, width: 1.2 });
  panel.addChild(bg);
  const body = new Container();
  body.position.set(-WIDTH / 2, -height + PAD / 2);
  row(body, 0, sides.attackers, tokens.ui.ink);
  row(body, ROW_H, sides.defenders, tokens.status.danger);
  const adv = new Graphics();
  const barW = WIDTH - PAD * 2;
  const y = ROW_H * 2 + PAD / 2;
  adv.roundRect(PAD, y, barW, BAR_H, 2).fill(tokens.status.danger);
  adv.roundRect(PAD, y, Math.max(2, barW * sides.advantage), BAR_H, 2).fill(tokens.status.success);
  body.addChild(adv);
  panel.addChild(body);
  panel.scale.set(k);
  panel.position.set(at.x, at.y - LIFT_PX * k);
  container.addChild(panel);
}
