export type MatchLayoutElementKind =
  'hud' | 'event-feed' | 'tutorial' | 'leaderboard' | 'bottom-panel' | 'card' | 'popup-menu';

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
  elements: MatchLayoutElement[];
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

function overlapIsAllowed(first: MatchLayoutElement, second: MatchLayoutElement): boolean {
  return (
    (first.kind === 'event-feed' && second.kind === 'leaderboard') ||
    (first.kind === 'leaderboard' && second.kind === 'event-feed')
  );
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
      if (second && overlaps(first, second) && !overlapIsAllowed(first, second)) {
        issues.push({ type: 'overlap', elements: [first.id, second.id] });
      }
    }
  }

  if (width > height && width <= 900 && layout.mapVisibleHeight < height / 2) {
    issues.push({ type: 'map-area-too-small' });
  }
  return issues;
}
