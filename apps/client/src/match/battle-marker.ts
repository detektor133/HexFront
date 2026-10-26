import { BitmapText, Container, Graphics } from 'pixi.js';

import { tokens } from '../theme/tokens.ts';

const BODY_RADIUS_PX = 12;
const PROTRUSION_LENGTH_PX = 7;
const PROTRUSION_BASE_HALF_PX = 5;
const BORDER_PX = 2;
const TEXT_PX = 12;

/** Состояние видимости иконки исхода и карточки прогноза. */
export interface BattleForecastPresentation {
  readonly showOutcomeIcon: boolean;
  readonly showForecastCard: boolean;
}

/** На карте постоянно видна только иконка; карточка появляется по явному наведению. */
export function getBattleForecastPresentation(input: {
  readonly hovered: boolean;
  readonly outcome: 'success' | 'warning' | 'danger';
}): BattleForecastPresentation {
  return { showOutcomeIcon: true, showForecastCard: input.hovered };
}

export interface BattleMarkerObject {
  readonly state: number | null;
  readonly container?: Container;
}

export interface BattleMarkerOptions {
  readonly direction?: readonly [number, number];
  readonly color?: string;
}

export interface BattleMarker<T extends BattleMarkerObject> {
  readonly object: T | null;
  update(state: number | null): void;
  destroy(): void;
}

function protrusion(direction: readonly [number, number]): number[] {
  const [x, y] = direction;
  const normalX = -y;
  const normalY = x;
  const baseX = x * BODY_RADIUS_PX;
  const baseY = y * BODY_RADIUS_PX;
  const tipX = baseX + x * PROTRUSION_LENGTH_PX;
  const tipY = baseY + y * PROTRUSION_LENGTH_PX;
  return [
    baseX + normalX * PROTRUSION_BASE_HALF_PX,
    baseY + normalY * PROTRUSION_BASE_HALF_PX,
    baseX - normalX * PROTRUSION_BASE_HALF_PX,
    baseY - normalY * PROTRUSION_BASE_HALF_PX,
    tipX,
    tipY,
  ];
}

function normalizeDirection(direction: readonly [number, number]): [number, number] {
  const length = Math.hypot(direction[0], direction[1]);
  if (length === 0) return [0, -1];
  return [direction[0] / length, direction[1] / length];
}

function drawMarker(
  advantage: number | null,
  direction: readonly [number, number],
  color: string,
): BattleMarkerObject {
  const container = new Container();
  const graphics = new Graphics();
  graphics.context.batchMode = 'batch';
  graphics.circle(0, 0, BODY_RADIUS_PX).fill(tokens.ui.surface);
  graphics.poly(protrusion(direction)).fill(tokens.ui.surface).stroke({
    color: tokens.ui.ink,
    width: BORDER_PX,
  });
  graphics.circle(0, 0, BODY_RADIUS_PX).stroke({ color: tokens.ui.ink, width: BORDER_PX });
  container.addChild(graphics);
  if (advantage !== null) {
    const text = new BitmapText({
      text: String(advantage),
      style: {
        fontFamily: tokens.font.ui.family,
        fontWeight: '500',
        fontSize: TEXT_PX,
        fill: color,
      },
    });
    text.anchor.set(0.5, 0.5);
    container.addChild(text);
  }
  return { state: advantage, container };
}

/** Создаёт направленный маркер боя и обновляет его только при изменении числа. */
export function createBattleMarker(
  options: BattleMarkerOptions = {},
): BattleMarker<BattleMarkerObject> {
  const direction = normalizeDirection(options.direction ?? [0, -1]);
  const color = options.color ?? tokens.ui.ink;
  const objects = new Map<number | null, BattleMarkerObject>();
  let object: BattleMarkerObject | null = null;
  let state: number | null | undefined;

  return {
    get object(): BattleMarkerObject | null {
      return object;
    },
    update(nextState: number | null): void {
      if (object !== null && state === nextState) return;
      object = objects.get(nextState) ?? null;
      if (object === null) {
        object = drawMarker(nextState, direction, color);
        objects.set(nextState, object);
      }
      state = nextState;
    },
    destroy(): void {
      for (const cached of objects.values())
        cached.container?.destroy({ children: true, context: true });
    },
  };
}
