import { Container, Graphics } from 'pixi.js';

import { tokens } from '../theme/tokens.ts';

const MARKER_RADIUS_PX = 8;
const MARKER_BORDER_PX = 2;
const SECTOR_BORDER_PX = 1.5;
const SECTOR_COUNT = 8;

/** Переводит организованность стороны в дискретное состояние сектора 0…7. */
export function battleOrgState(
  ownOrganization: number | null,
  enemyOrganization: number | null,
): number | null {
  if (ownOrganization === null || enemyOrganization === null) return null;
  const total = ownOrganization + enemyOrganization;
  if (total <= 0) return null;
  return Math.min(SECTOR_COUNT - 1, Math.floor((ownOrganization / total) * SECTOR_COUNT));
}

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
  return {
    showOutcomeIcon: true,
    showForecastCard: input.hovered,
  };
}

export interface BattleMarkerObject {
  readonly state: number | null;
  readonly container?: Container;
}

export interface BattleMarkerOptions {
  readonly ownColor?: string;
  readonly enemyColor?: string;
}

export interface BattleMarker<T extends BattleMarkerObject> {
  readonly object: T | null;
  update(state: number | null): void;
  destroy(): void;
}

function drawState(state: number | null, ownColor: string, enemyColor: string): BattleMarkerObject {
  const container = new Container();
  const graphics = new Graphics();
  graphics.context.batchMode = 'batch';
  graphics.circle(0, 0, MARKER_RADIUS_PX).fill(tokens.ui.surface);

  if (state === null) {
    graphics.circle(0, 0, MARKER_RADIUS_PX).fill(tokens.ui.border);
  } else {
    const ownShare = state / SECTOR_COUNT;
    const start = -Math.PI / 2;
    const split = start + Math.PI * 2 * ownShare;
    graphics
      .moveTo(0, 0)
      .arc(0, 0, MARKER_RADIUS_PX, start, split)
      .lineTo(0, 0)
      .fill(ownColor)
      .stroke({ color: tokens.ui.surface, width: SECTOR_BORDER_PX });
    graphics
      .moveTo(0, 0)
      .arc(0, 0, MARKER_RADIUS_PX, split, start + Math.PI * 2)
      .lineTo(0, 0)
      .fill(enemyColor)
      .stroke({ color: tokens.ui.surface, width: SECTOR_BORDER_PX });
  }

  graphics.circle(0, 0, MARKER_RADIUS_PX).stroke({
    color: tokens.ui.ink,
    width: MARKER_BORDER_PX,
  });
  container.addChild(graphics);
  return { state, container };
}

/** Создаёт маркер с кэшем: Pixi-объект меняется только при смене состояния. */
export function createBattleMarker(
  options: BattleMarkerOptions = {},
): BattleMarker<BattleMarkerObject> {
  const states = Array.from({ length: SECTOR_COUNT }, (_, index) =>
    drawState(
      index,
      options.ownColor ?? tokens.players.palette[0]?.line ?? tokens.ui.ink,
      options.enemyColor ?? tokens.players.palette[1]?.line ?? tokens.ui.ink,
    ),
  );
  states.push(
    drawState(
      null,
      options.ownColor ?? tokens.players.palette[0]?.line ?? tokens.ui.ink,
      options.enemyColor ?? tokens.players.palette[1]?.line ?? tokens.ui.ink,
    ),
  );
  let object: BattleMarkerObject | null = null;
  let state: number | null | undefined;

  return {
    get object(): BattleMarkerObject | null {
      return object;
    },
    update(nextState: number | null): void {
      if (object !== null && state === nextState) return;
      object = states[nextState === null ? SECTOR_COUNT : nextState] as BattleMarkerObject;
      state = nextState;
    },
    destroy(): void {
      for (const cached of states) cached.container?.destroy({ children: true });
    },
  };
}
