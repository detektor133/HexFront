export type MatchLayoutElementKind =
  'hud' | 'left-column' | 'leaderboard' | 'bottom-panel' | 'card' | 'popup-menu' | 'pause-menu';

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

function cardOpenOnPhone(input: MatchLayoutInput, width: number): boolean {
  const edge = width <= 600 ? 8 : 16;
  return input.cardOpen && width < edge * 2 + 640 + 8;
}

export function computeMatchLayout(input: MatchLayoutInput): MatchLayoutSnapshot {
  const { width, height } = input.viewport;
  const edge = width <= 600 || height <= 500 ? 8 : 16;
  const gap = 8;
  const landscapeWithoutSelection = width > height && !input.cardOpen;
  const maxBottomPanelHeight = landscapeWithoutSelection
    ? Math.floor(height / 2) - input.hudHeight
    : height - input.hudHeight - gap;
  const bottomPanelHeight = Math.min(
    input.bottomPanelHeight,
    Math.max(44, maxBottomPanelHeight),
    Math.max(44, height - input.hudHeight - gap),
  );
  const bottomY = height - bottomPanelHeight;
  const elements: MatchLayoutElement[] = [
    layoutElement('hud', 'hud', 0, 0, width, input.hudHeight),
  ];
  const showLeaderboard = !input.paused && !input.popupOpen && !cardOpenOnPhone(input, width);
  if (!input.paused && !input.popupOpen) {
    elements.push(
      layoutElement('bottom-panel', 'bottom-panel', 0, bottomY, width, bottomPanelHeight),
    );
  }
  const leaderboardWidth = input.leaderboardOpen ? (width <= 600 ? width - edge * 2 : 320) : 180;
  const leaderboardRows = Math.min(5, Math.max(0, input.leaderboardRows));
  const leaderboardHeight = input.leaderboardOpen
    ? Math.min(
        Math.max(44, leaderboardRows * 44 + 16),
        Math.max(44, bottomY - gap - input.hudHeight),
      )
    : 44;
  if (showLeaderboard) {
    elements.push(
      layoutElement(
        'leaderboard',
        'leaderboard',
        Math.max(edge, width - edge - leaderboardWidth),
        input.hudHeight + gap,
        leaderboardWidth,
        leaderboardHeight,
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
    !input.leaderboardOpen &&
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
    elements.push(
      layoutElement(
        'card',
        'card',
        edge,
        Math.max(input.hudHeight + gap, bottomY - gap - input.cardHeight),
        Math.min(320, width - edge * 2),
        Math.min(input.cardHeight, cardAvailableHeight),
      ),
    );
  }
  if (input.popupOpen || input.paused) {
    const popupWidth = input.popupSize?.width ?? Math.min(260, width - edge * 2);
    const popupHeight =
      input.popupSize?.height ?? Math.min(120, height - input.hudHeight - gap - edge);
    const popupX = Math.min(
      Math.max(edge, input.popupAnchorX ?? (width - popupWidth) / 2),
      width - edge - popupWidth,
    );
    elements.push(
      layoutElement(
        input.paused ? 'pause-menu' : 'popup-menu',
        input.paused ? 'pause-menu' : 'popup-menu',
        input.paused ? Math.max(edge, (width - 280) / 2) : popupX,
        input.paused
          ? Math.max(input.hudHeight + gap, (height - 240) / 2)
          : (input.popupAnchorY ?? input.hudHeight),
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
