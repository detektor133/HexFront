// Слой отрядов песочницы (03/T17): фишки по units.md, плавное движение по прогрессу перехода,
// путь с бегущими штрихами, маркер боя, зона и линия огня артиллерии, призрак набора в городе.
import { Container, Graphics } from 'pixi.js';

import {
  distance,
  hexFromId,
  hexId,
  inBounds,
  neighbors,
  ORG_MAX,
  TICK_MS,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import type { Picked } from './sandbox-selection.ts';
import { createChip, type Chip, type ChipState, type ChipStyle } from './unit-chips.ts';
import { hexEdge, type Point } from '../render/hex-geometry.ts';
import { armyColor, playerLine } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

/** Сдвиг фишки вниз, если в гексе город (знак города — в центре), и призрака набора вверх. */
const CITY_SHIFT = 0.62;
/** Пути и линии огня — экранные px. */
const PATH_PX = 2;
const PATH_DASH = 6;
const PATH_GAP = 5;
/** Скорость бега штрихов, px/с экрана. */
const PATH_SPEED = 24;
const FIRE_PX = 1.5;
const RANGE_PX = 2;
/** Масштаб фишки в мире: при масштабе карты 1 — эта доля размеров units.md (растёт с картой). */
const CHIP_WORLD = 0.55;
/** Постоянная сглаживания позиции фишки, мс: скачки снимка превращаются в плавный доезд. */
const SMOOTH_MS = 90;
/** Шаг разрешения текста — чтобы не перерисовывать текст на каждом шаге колеса. */
const RES_STEP = 0.5;
const ARTY_RANGE_HEXES = 2;
/** Маркер боя (units.md): ⌀16, обводка 2, крест 7, пульс 1,0 → 1,15 за 800 мс. */
const BATTLE_R = 8;
const BATTLE_CROSS = 3.5;
const BATTLE_PULSE_MS = 800;
const BATTLE_PULSE = 0.15;
const FULL = 1000;

export interface UnitLayer {
  readonly container: Container;
  setView(view: PlayerView, picked: Picked, nowMs: number): void;
  setScale(scale: number): void;
  /** Вариант фишки (переключатель песочницы, CR-003). */
  setChipStyle(style: ChipStyle): void;
  frame(nowMs: number): void;
  destroy(): void;
}

interface Entry {
  readonly key: string;
  /** Отряды фишки — чтобы новая фишка начинала с прежнего места своих отрядов. */
  readonly units: readonly number[];
  readonly state: ChipState;
  /** Точка фишки при доле текущего тика frac ∈ [0, 1]. */
  at(frac: number): Point;
}

/** Пунктир по ломаной со сдвигом phase — для бегущих штрихов. */
export function dashedPath(
  g: Graphics,
  pts: readonly Point[],
  dash: number,
  gap: number,
  phase: number,
): void {
  let carry = -phase;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    for (let t = carry; t < len; t += dash + gap) {
      const s = Math.max(0, t);
      const e = Math.min(len, t + dash);
      if (e <= s) continue;
      g.moveTo(a.x + ((b.x - a.x) * s) / len, a.y + ((b.y - a.y) * s) / len);
      g.lineTo(a.x + ((b.x - a.x) * e) / len, a.y + ((b.y - a.y) * e) / len);
    }
    carry = ((((carry - len) % (dash + gap)) + (dash + gap)) % (dash + gap)) - (dash + gap);
  }
}

/** Создаёт слой; center — центр гекса в мировых координатах. */
export function createUnitLayer(
  width: number,
  radius: number,
  center: (hex: number) => Point,
): UnitLayer {
  const container = new Container();
  const ground = new Graphics();
  const chipsLayer = new Container();
  container.addChild(ground, chipsLayer);
  const chips = new Map<string, Chip>();
  let entries: Entry[] = [];
  let view: PlayerView | null = null;
  let picked: Picked = { hex: null, units: [], target: null };
  let snapAt = 0;
  let k = 1;
  let textRes = window.devicePixelRatio;
  let lastFrame = 0;
  let chipStyle: ChipStyle = 'hoi';
  /** Показанные позиции: фишек — для сглаживания, отрядов — для старта новых фишек и путей. */
  const drawnAt = new Map<string, Point>();
  const shown = new Map<number, Point>();
  const cities = new Set<number>();

  const base = (hex: number): Point => {
    const c = center(hex);
    return cities.has(hex) ? { x: c.x, y: c.y + radius * CITY_SHIFT } : c;
  };
  // Идущий отряд — между центрами гексов по прогрессу перехода (+ доля текущего тика).
  const unitAt = (u: UnitView, frac: number): Point => {
    const next = u.path[0];
    const a = base(u.hex);
    if (next === undefined || u.moveTotal <= 0 || u.order === 'retreat') return a;
    const b = base(next);
    const p = Math.min(1, (u.moveTicks + frac) / u.moveTotal);
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
  };

  function stateOf(units: readonly UnitView[], v: PlayerView): ChipState {
    const byType = new Map<string, number>();
    let soldiers = 0;
    for (const u of units) {
      soldiers += u.soldiers;
      byType.set(u.type, (byType.get(u.type) ?? 0) + u.soldiers);
    }
    const first = units[0] as UnitView;
    let type = first.type;
    for (const u of units) if ((byType.get(u.type) ?? 0) > (byType.get(type) ?? 0)) type = u.type;
    const weighted = (f: (u: UnitView) => number): number =>
      units.reduce((s, u) => s + f(u) * u.soldiers, 0) / Math.max(1, soldiers);
    const army = v.armies.find((a) => a.id === first.armyId);
    const oneArmy = army !== undefined && units.every((u) => u.armyId === army.id);
    const mine = first.owner === v.playerId;
    return {
      style: chipStyle,
      color: playerLine(first.owner),
      army: oneArmy ? armyColor(v.playerId, army.number) : null,
      type,
      soldiers,
      org: weighted((u) => u.org) / ORG_MAX,
      supply: mine ? weighted((u) => u.supplyLevel ?? FULL) / FULL : null,
      starving: units.some((u) => u.starving === true),
      count: units.length,
      selected: units.some((u) => picked.units.includes(u.id)),
      retreating: units.some((u) => u.order === 'retreat'),
      encircled: mine && units.some((u) => u.encircled === true),
      hold: units.every((u) => u.order === 'hold'),
      ghost: false,
    };
  }

  function build(v: PlayerView): Entry[] {
    const out: Entry[] = [];
    const stacks = new Map<string, UnitView[]>();
    for (const u of v.units) {
      if (u.moveTotal > 0 && u.path.length > 0 && u.order !== 'retreat') {
        out.push({
          key: `u${u.id}`,
          units: [u.id],
          state: stateOf([u], v),
          at: (f) => unitAt(u, f),
        });
        continue;
      }
      const key = `h${u.owner}:${u.hex}`;
      stacks.set(key, [...(stacks.get(key) ?? []), u]);
    }
    for (const [key, units] of stacks) {
      const hex = (units[0] as UnitView).hex;
      out.push({
        key,
        units: units.map((u) => u.id),
        state: stateOf(units, v),
        at: () => base(hex),
      });
    }
    for (const r of v.recruits) {
      const city = v.cities.find((c) => c.id === r.cityId);
      if (!city) continue;
      const c = center(city.hex);
      out.push({
        key: `r${r.id}`,
        units: [],
        state: {
          style: chipStyle,
          color: playerLine(v.playerId),
          army: null,
          type: r.type,
          soldiers: r.soldiers,
          org: r.progressTicks / Math.max(1, r.totalTicks),
          supply: null,
          starving: false,
          count: 1,
          selected: false,
          retreating: false,
          encircled: false,
          hold: false,
          ghost: true,
        },
        at: () => ({ x: c.x, y: c.y - radius * CITY_SHIFT }),
      });
    }
    return out;
  }

  function drawGround(v: PlayerView, frac: number, nowMs: number): void {
    ground.clear();
    const mine = v.units.filter((u) => u.owner === v.playerId);
    // Зона огня выбранной артиллерии: контур области гексов в радиусе ARTY_RANGE.
    const arty = mine.filter((u) => u.type === 'artillery' && picked.units.includes(u.id));
    if (arty.length > 0) {
      const inside = new Set<number>();
      v.hexes.owner.forEach((_, id) => {
        const h = hexFromId(id, width);
        if (arty.some((a) => distance(hexFromId(a.hex, width), h) <= ARTY_RANGE_HEXES))
          inside.add(id);
      });
      const height = v.hexes.owner.length / width;
      for (const id of inside) {
        neighbors(hexFromId(id, width)).forEach((n, d) => {
          if (inBounds(n, width, height) && inside.has(hexId(n, width))) return;
          const [p, q] = hexEdge(center(id), radius, d);
          ground.moveTo(p.x, p.y).lineTo(q.x, q.y);
        });
      }
      ground.stroke({ color: playerLine(v.playerId), width: RANGE_PX * k, cap: 'round' });
    }
    // Пути своих отрядов: пунктир от фишки до цели, штрихи бегут к цели.
    const phase = ((nowMs / 1000) * PATH_SPEED) % (PATH_DASH + PATH_GAP);
    for (const u of mine) {
      if (u.path.length === 0) continue;
      const pts = [shown.get(u.id) ?? unitAt(u, frac), ...u.path.map(base)];
      dashedPath(ground, pts, PATH_DASH * k, PATH_GAP * k, phase * k);
      ground.stroke({ color: playerLine(u.owner), width: PATH_PX * k, cap: 'round' });
      const end = pts[pts.length - 1] as Point;
      ground.circle(end.x, end.y, 4 * k).stroke({ color: playerLine(u.owner), width: PATH_PX * k });
    }
    // Линия огня своей артиллерии.
    for (const a of mine) {
      const target = v.units.find((x) => x.id === a.fireTarget);
      if (a.type !== 'artillery' || !target) continue;
      const p = base(a.hex);
      const q = base(target.hex);
      dashedPath(ground, [p, q], 3 * k, 3 * k, 0);
      ground.stroke({ color: tokens.status.danger, width: FIRE_PX * k });
    }
    // Маркер боя на середине общего ребра — по одному на пару «откуда — куда».
    const pulse =
      1 + BATTLE_PULSE * (0.5 + 0.5 * Math.sin((2 * Math.PI * nowMs) / BATTLE_PULSE_MS));
    const drawn = new Set<string>();
    for (const u of v.units) {
      if (u.order !== 'attack' || u.target < 0 || drawn.has(`${u.hex}:${u.target}`)) continue;
      drawn.add(`${u.hex}:${u.target}`);
      const a = center(u.hex);
      const b = center(u.target);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = BATTLE_R * CHIP_WORLD * pulse;
      const c = BATTLE_CROSS * CHIP_WORLD * pulse;
      ground
        .circle(m.x, m.y, r)
        .fill(tokens.ui.surface)
        .stroke({ color: tokens.ui.ink, width: 2 * CHIP_WORLD });
      ground
        .moveTo(m.x - c, m.y - c)
        .lineTo(m.x + c, m.y + c)
        .moveTo(m.x + c, m.y - c)
        .lineTo(m.x - c, m.y + c);
      ground.stroke({ color: tokens.ui.ink, width: 2 * CHIP_WORLD, cap: 'round' });
    }
  }

  function syncChips(): void {
    const keep = new Set(entries.map((e) => e.key));
    for (const [key, chip] of chips) {
      if (keep.has(key)) continue;
      chip.destroy();
      chips.delete(key);
      drawnAt.delete(key);
    }
    for (const e of entries) {
      let chip = chips.get(e.key);
      if (!chip) {
        chip = createChip();
        chips.set(e.key, chip);
        chipsLayer.addChild(chip.root);
        // Новая фишка (отряд встал или начал путь) стартует с прежнего места своих отрядов.
        const from = e.units.map((id) => shown.get(id)).find((pt) => pt !== undefined);
        if (from) drawnAt.set(e.key, from);
      }
      chip.setResolution(textRes);
      chip.draw(e.state);
    }
  }

  const layer: UnitLayer = {
    container,
    setView(v, p, nowMs) {
      view = v;
      picked = p;
      snapAt = nowMs;
      cities.clear();
      for (const c of v.cities) cities.add(c.hex);
      entries = build(v);
      syncChips();
      layer.frame(nowMs);
    },
    setChipStyle(style) {
      chipStyle = style;
      if (!view) return;
      entries = build(view);
      syncChips();
    },
    setScale(scale) {
      k = 1 / scale;
      const res = Math.ceil((window.devicePixelRatio * scale * CHIP_WORLD) / RES_STEP) * RES_STEP;
      textRes = Math.max(1, res * 2);
      for (const chip of chips.values()) chip.setResolution(textRes);
    },
    frame(nowMs) {
      if (!view) return;
      const frac = Math.min(1, Math.max(0, (nowMs - snapAt) / TICK_MS));
      const blend = lastFrame === 0 ? 1 : 1 - Math.exp(-(nowMs - lastFrame) / SMOOTH_MS);
      lastFrame = nowMs;
      for (const e of entries) {
        const chip = chips.get(e.key);
        if (!chip) continue;
        const target = e.at(frac);
        const prev = drawnAt.get(e.key) ?? target;
        const at = {
          x: prev.x + (target.x - prev.x) * blend,
          y: prev.y + (target.y - prev.y) * blend,
        };
        drawnAt.set(e.key, at);
        for (const id of e.units) shown.set(id, at);
        chip.root.position.set(at.x, at.y);
        chip.root.scale.set(CHIP_WORLD);
      }
      drawGround(view, frac, nowMs);
    },
    destroy() {
      for (const chip of chips.values()) chip.destroy();
      container.destroy({ children: true });
    },
  };
  return layer;
}
