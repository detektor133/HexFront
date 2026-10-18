export type MatchLayoutElementKind =
  'hud' | 'left-column' | 'leaderboard' | 'bottom-panel' | 'card' | 'popup-menu' | 'pause-menu';

const HUD_MAX_WIDTH = 720;
const LEADERBOARD_DESKTOP_WIDTH = 150;
const LEADERBOARD_HEADER_HEIGHT = 16;
const LEADERBOARD_ALIVE_HEIGHT = 18;
const LEADERBOARD_ROW_HEIGHT = 16;
const LEADERBOARD_ROW_GAP = 2;
const LEADERBOARD_PADDING = 12;
const LEADERBOARD_BORDER_WIDTH = 2;
const MOBILE_LEADERBOARD_HEADER_HEIGHT = 44;
const MOBILE_LEADERBOARD_ALIVE_HEIGHT = 28;
const MOBILE_LEADERBOARD_ROW_HEIGHT = 28;
const MOBILE_LEADERBOARD_ROW_GAP = 4;
const MOBILE_LEADERBOARD_PADDING = 16;

export interface MatchLayoutElement {
  readonly id: string;
  readonly kind: MatchLayoutElementKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly interactive: boolean;
  readonly fontSize: number;
}

export interface MatchLayoutSnapshot {
  readonly scene:
    | 'start-with-tutorial'
    | 'selected-hex'
    | 'selected-army'
    | 'leaderboard-open'
    | 'pause-menu-open';
  readonly viewport: { readonly width: number; readonly height: number };
  readonly hudHeight: number;
  readonly bottomPanelHeight: number;
  mapVisibleHeight: number;
  readonly hasSelection: boolean;
  elements: MatchLayoutElement[];
}

export interface MatchLayoutInput {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly hudHeight: number;
  readonly bottomPanelHeight: number;
  readonly eventRows: number;
  readonly tutorialVisible: boolean;
  readonly leaderboardOpen: boolean;
  readonly leaderboardRows: number;
  readonly leaderboardPlayerNames?: readonly string[];
  readonly cardHeight: number;
  readonly cardOpen: boolean;
  readonly popupOpen: boolean;
  readonly popupAnchorX?: number;
  readonly popupAnchorY?: number;
  readonly popupSize?: { readonly width: number; readonly height: number };
  readonly paused: boolean;
}

export function matchLayoutElementStyle(element: MatchLayoutElement): CSSProperties {
  return {
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
  };
}

export type MatchLayoutIssue =
  | { readonly type: 'overlap'; readonly elements: readonly [string, string] }
  | { readonly type: 'interactive-too-small'; readonly element: string }
  | { readonly type: 'text-too-small'; readonly element: string }
  | { readonly type: 'out-of-bounds'; readonly element: string }
  | { readonly type: 'map-area-too-small' };

function overlaps(first: MatchLayoutElement, second: MatchLayoutElement): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function layoutElement(
  id: string,
  kind: MatchLayoutElementKind,
  x: number,
  y: number,
  width: number,
  height: number,
  interactive = false,
): MatchLayoutElement {
  return { id, kind, x, y, width, height, interactive, fontSize: 12 };
}

function cardOpenOnPhone(input: MatchLayoutInput, width: number, height: number): boolean {
  const edge = width <= 600 ? 8 : 16;
  return input.cardOpen && (width <= 600 || height <= 500 || width <= edge * 2 + 640 + 8);
}

export function computeMatchLayout(input: MatchLayoutInput): MatchLayoutSnapshot {
  const { width, height } = input.viewport;
  const edge = width <= 600 || height <= 500 ? 8 : 16;
  const gap = 8;
  const phoneViewport = width <= 600 || height <= 500;
  const landscapeWithoutSelection = phoneViewport && width > height && !input.cardOpen;
  const maxBottomPanelHeight = landscapeWithoutSelection
    ? Math.floor(height / 2) - input.hudHeight
    : height - input.hudHeight - gap;
  const bottomPanelHeight = Math.min(
    input.bottomPanelHeight,
    Math.max(44, maxBottomPanelHeight),
    Math.max(44, height - input.hudHeight - gap),
  );
  const bottomY = height - bottomPanelHeight;
  const hudWidth = width <= 600 ? width : Math.min(width - edge * 2, HUD_MAX_WIDTH);
  const hudX = (width - hudWidth) / 2;
  const desktop = !phoneViewport;
  const elements: MatchLayoutElement[] = [
    layoutElement('hud', 'hud', hudX, 0, hudWidth, input.hudHeight),
  ];
  const leaderboardWidth = desktop
    ? LEADERBOARD_DESKTOP_WIDTH
    : input.leaderboardOpen
      ? width - edge * 2
      : 180;
  const leaderboardRows = Math.min(5, Math.max(0, input.leaderboardRows));
  const leaderboardHeight = input.leaderboardOpen
    ? LEADERBOARD_BORDER_WIDTH +
      MOBILE_LEADERBOARD_PADDING +
      MOBILE_LEADERBOARD_HEADER_HEIGHT +
      MOBILE_LEADERBOARD_ALIVE_HEIGHT +
      leaderboardRows * MOBILE_LEADERBOARD_ROW_HEIGHT +
      Math.max(0, leaderboardRows - 1) * MOBILE_LEADERBOARD_ROW_GAP
    : 44;
  const desktopLeaderboardHeight =
    LEADERBOARD_BORDER_WIDTH +
    LEADERBOARD_PADDING +
    LEADERBOARD_HEADER_HEIGHT +
    LEADERBOARD_ALIVE_HEIGHT +
    leaderboardRows * LEADERBOARD_ROW_HEIGHT +
    Math.max(0, leaderboardRows - 1) * LEADERBOARD_ROW_GAP;
  const popupWidth = input.popupSize?.width ?? Math.min(260, width - edge * 2);
  const popupHeight =
    input.popupSize?.height ?? Math.min(120, height - input.hudHeight - gap - edge);
  const popupX = Math.min(
    Math.max(edge, input.popupAnchorX ?? (width - popupWidth) / 2),
    width - edge - popupWidth,
  );
  const popupY = input.popupAnchorY ?? input.hudHeight;
  const defaultLeaderboardY = input.hudHeight + gap;
  const effectiveLeaderboardHeight = desktop ? desktopLeaderboardHeight : leaderboardHeight;
  const popupOverlapsLeaderboard =
    input.popupOpen &&
    popupX < width - edge &&
    popupX + popupWidth > Math.max(edge, width - edge - leaderboardWidth) &&
    popupY < defaultLeaderboardY + effectiveLeaderboardHeight &&
    popupY + popupHeight > defaultLeaderboardY;
  const leaderboardY = popupOverlapsLeaderboard ? popupY + popupHeight + gap : defaultLeaderboardY;
  const leaderboardFitsViewport = leaderboardY + effectiveLeaderboardHeight <= height;
  const leaderboardFitsAboveBottomPanel =
    leaderboardY + effectiveLeaderboardHeight <= bottomY - gap;
  const showBottomPanel =
    !input.paused &&
    !input.popupOpen &&
    (desktop || !input.leaderboardOpen || leaderboardFitsAboveBottomPanel);
  const showLeaderboard =
    !input.paused && !cardOpenOnPhone(input, width, height) && (desktop || leaderboardFitsViewport);
  if (showBottomPanel) {
    elements.push(
      layoutElement('bottom-panel', 'bottom-panel', 0, bottomY, width, bottomPanelHeight),
    );
  }
  if (showLeaderboard) {
    elements.push(
      layoutElement(
        'leaderboard',
        'leaderboard',
        Math.max(edge, width - edge - leaderboardWidth),
        leaderboardY,
        leaderboardWidth,
        effectiveLeaderboardHeight,
        true,
      ),
    );
  }
  const leftWidth = Math.min(280, Math.max(44, width - leaderboardWidth - edge * 3));
  const eventHeight = Math.min(3, Math.max(0, input.eventRows)) * 44;
  const leftColumnTop = input.hudHeight + gap;
  const leftColumnBottom = bottomY - gap;
  const eventVisible = eventHeight > 0 && leftColumnTop + eventHeight <= leftColumnBottom;
  const tutorialY = leftColumnTop + (eventVisible ? eventHeight + gap : 0);
  const tutorialVisible = input.tutorialVisible && tutorialY + 48 <= leftColumnBottom;
  const leftColumnVisible =
    (eventVisible || tutorialVisible) &&
    !input.cardOpen &&
    (desktop || !input.leaderboardOpen) &&
    !input.popupOpen &&
    !input.paused;
  if (leftColumnVisible) {
    const tutorialHeight = tutorialVisible ? 48 : 0;
    const leftColumnHeight = Math.min(
      leftColumnBottom - leftColumnTop,
      eventVisible ? eventHeight + (tutorialHeight > 0 ? gap + tutorialHeight : 0) : tutorialHeight,
    );
    elements.push(
      layoutElement('left-column', 'left-column', edge, leftColumnTop, leftWidth, leftColumnHeight),
    );
  }
  const cardAvailableHeight = bottomY - input.hudHeight - gap * 2;
  if (input.cardOpen && !input.popupOpen && !input.paused && cardAvailableHeight >= 44) {
    const cardHeight = Math.min(Math.max(44, input.cardHeight), cardAvailableHeight);
    elements.push(
      layoutElement(
        'card',
        'card',
        edge,
        Math.max(input.hudHeight + gap, bottomY - gap - cardHeight),
        Math.min(320, width - edge * 2),
        cardHeight,
      ),
    );
  }
  if (input.popupOpen || input.paused) {
    elements.push(
      layoutElement(
        input.paused ? 'pause-menu' : 'popup-menu',
        input.paused ? 'pause-menu' : 'popup-menu',
        input.paused ? Math.max(edge, (width - 280) / 2) : popupX,
        input.paused ? Math.max(input.hudHeight + gap, (height - 240) / 2) : popupY,
        popupWidth,
        input.paused
          ? Math.max(44, Math.min(240, height - input.hudHeight - gap - edge))
          : popupHeight,
        true,
      ),
    );
  }
  return {
    scene: input.paused
      ? 'pause-menu-open'
      : input.cardOpen
        ? 'selected-army'
        : input.leaderboardOpen
          ? 'leaderboard-open'
          : input.tutorialVisible
            ? 'start-with-tutorial'
            : 'selected-hex',
    viewport: input.viewport,
    hudHeight: input.hudHeight,
    bottomPanelHeight,
    mapVisibleHeight: Math.max(
      0,
      height - input.hudHeight - (input.paused || input.popupOpen ? 0 : bottomPanelHeight),
    ),
    hasSelection: input.cardOpen,
    elements,
  };
}

export function validateMatchLayout(layout: MatchLayoutSnapshot): MatchLayoutIssue[] {
  const issues: MatchLayoutIssue[] = [];
  const { width, height } = layout.viewport;

  for (const element of layout.elements) {
    if (
      element.x < 0 ||
      element.y < 0 ||
      element.x + element.width > width ||
      element.y + element.height > height
    ) {
      issues.push({ type: 'out-of-bounds', element: element.id });
    }
    if (element.interactive && (element.width < 44 || element.height < 44)) {
      issues.push({ type: 'interactive-too-small', element: element.id });
    }
    if (element.fontSize < 12) {
      issues.push({ type: 'text-too-small', element: element.id });
    }
  }

  for (let firstIndex = 0; firstIndex < layout.elements.length; firstIndex += 1) {
    const first = layout.elements[firstIndex];
    if (!first) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < layout.elements.length; secondIndex += 1) {
      const second = layout.elements[secondIndex];
      if (second && overlaps(first, second)) {
        issues.push({ type: 'overlap', elements: [first.id, second.id] });
      }
    }
  }

  if (
    width > height &&
    width <= 900 &&
    !layout.hasSelection &&
    layout.mapVisibleHeight < height / 2
  ) {
    issues.push({ type: 'map-area-too-small' });
  }
  return issues;
}
import type { CSSProperties } from 'react';
