// Отряды в песочнице (03/T12) — временный вид до фишек 04/T5: кружок цвета владельца с числом
// солдат, маркер боя, состояния отступления, котла и низкого снабжения.
import type { Container, Graphics } from 'pixi.js';
import { Text } from 'pixi.js';

import type { PlayerView, UnitType } from '@hexfront/sim';

import { formatSoldiers } from '../i18n/format.ts';
import type { Point } from '../render/hex-geometry.ts';
import { playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Радиус кружка отряда и сдвиг вниз от центра гекса — доли радиуса гекса (центр — у города). */
const CIRCLE_SHARE = 0.42;
const OFFSET_SHARE = 0.32;
/** Размер числа — доля радиуса гекса; длиннее FIT_CHARS знаков — шрифт уменьшается, чтобы влезть в кружок. */
const LABEL_SHARE = 0.34;
const FIT_CHARS = 3;
/** Предел разрешения текста: выше — лишняя память без видимой разницы. */
const MAX_TEXT_RESOLUTION = 8;
/** Точка маркера боя — доля радиуса гекса. */
const BATTLE_DOT_SHARE = 0.24;
/** Толщины в экранных px (токенов нет — отладочный вид). */
const OUTLINE_PX = 1.5;
const RING_PX = 2;
const BATTLE_PX = 3;
const LOW_SUPPLY = 500;

/** Отряды одного владельца в одном гексе — один кружок. */
export interface UnitGroup {
  readonly hex: number;
  readonly owner: number;
  readonly soldiers: number;
  readonly count: number;
  readonly type: UnitType;
  readonly selected: boolean;
  readonly retreating: boolean;
  readonly encircled: boolean;
  readonly lowSupply: boolean;
}

/** Группирует отряды снимка по гексу; тип — преобладающий по солдатам. */
export function groupUnits(view: PlayerView, selected: readonly number[]): UnitGroup[] {
  const groups = new Map<number, UnitGroup & { byType: Map<UnitType, number> }>();
  for (const u of view.units) {
    const g = groups.get(u.hex) ?? {
      hex: u.hex,
      owner: u.owner,
      soldiers: 0,
      count: 0,
      type: u.type,
      selected: false,
      retreating: false,
      encircled: false,
      lowSupply: false,
      byType: new Map<UnitType, number>(),
    };
    g.byType.set(u.type, (g.byType.get(u.type) ?? 0) + u.soldiers);
    groups.set(u.hex, {
      ...g,
      soldiers: g.soldiers + u.soldiers,
      count: g.count + 1,
      selected: g.selected || selected.includes(u.id),
      retreating: g.retreating || u.order === 'retreat',
      encircled: g.encircled || u.encircled === true,
      lowSupply: g.lowSupply || (u.supplyLevel !== null && u.supplyLevel < LOW_SUPPLY),
    });
  }
  return [...groups.values()].map(({ byType, ...g }) => {
    let type = g.type;
    for (const [t, n] of byType) if (n > (byType.get(type) ?? 0)) type = t;
    return { ...g, type };
  });
}

/** Рисует маркеры боя, кружки отрядов и числа; k = 1 / масштаб камеры. */
export function drawUnits(
  g: Graphics,
  labels: Container,
  view: PlayerView,
  groups: readonly UnitGroup[],
  center: (hex: number) => Point,
  hexRadius: number,
  k: number,
): void {
  for (const lbl of labels.removeChildren()) lbl.destroy();
  for (const u of view.units) {
    if (u.order !== 'attack' || u.target < 0) continue;
    // Линия боя — от кружка отряда (он ниже центра гекса) к центру цели.
    const from = center(u.hex);
    const a = { x: from.x, y: from.y + hexRadius * OFFSET_SHARE };
    const b = center(u.target);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    g.moveTo(a.x, a.y)
      .lineTo(mid.x, mid.y)
      .stroke({ color: tokens.status.danger, width: BATTLE_PX * k });
    g.circle(mid.x, mid.y, hexRadius * BATTLE_DOT_SHARE)
      .fill(tokens.status.danger)
      .stroke({ color: tokens.ui.surface, width: OUTLINE_PX * k });
  }
  const r = hexRadius * CIRCLE_SHARE;
  for (const grp of groups) {
    const c = center(grp.hex);
    const at = { x: c.x, y: c.y + hexRadius * OFFSET_SHARE };
    g.circle(at.x, at.y, r)
      .fill({ color: playerLine(grp.owner), alpha: grp.retreating ? 0.5 : 1 })
      .stroke({ color: tokens.ui.surface, width: OUTLINE_PX * k });
    if (grp.selected)
      g.circle(at.x, at.y, r + RING_PX * 2 * k).stroke({
        color: tokens.ui.ink,
        width: RING_PX * k,
      });
    if (grp.encircled) {
      g.circle(at.x, at.y, r + RING_PX * 4 * k).stroke({
        color: tokens.status.encircled,
        width: RING_PX * k,
      });
    } else if (grp.lowSupply) {
      g.circle(at.x + r * 0.8, at.y - r * 0.8, r * 0.28).fill(tokens.status.lowSupply);
    }
    const text =
      grp.count > 1 ? `${formatSoldiers(grp.soldiers)}·${grp.count}` : formatSoldiers(grp.soldiers);
    const fit = Math.min(1, FIT_CHARS / text.length);
    const label = new Text({
      text,
      // Текст растеризуется в разрешении масштаба камеры, иначе при приближении он размыт.
      resolution: Math.min(MAX_TEXT_RESOLUTION, window.devicePixelRatio / k),
      style: {
        fontFamily: tokens.font.ui.family,
        fontWeight: '500',
        fontSize: hexRadius * LABEL_SHARE * fit,
        fill: tokens.ui.surface,
      },
    });
    label.anchor.set(0.5);
    label.position.set(at.x, at.y);
    labels.addChild(label);
  }
}
