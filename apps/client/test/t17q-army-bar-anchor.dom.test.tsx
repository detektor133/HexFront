import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const armyBarCss = readFileSync('apps/client/src/dev/ArmyBar.module.css', 'utf8');

describe('07/T17q: нижняя привязка ArmyBar', () => {
  it.each([
    [360, 640],
    [1440, 900],
    [1920, 1080],
  ])('сохраняет отдельный прямоугольник панели при размере %dx%d', (width, height) => {
    const layout = computeMatchLayout({
      viewport: { width, height },
      hudHeight: 88,
      bottomPanelHeight: 150,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: false,
      leaderboardRows: 0,
      cardHeight: 220,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });
    const panel = layout.elements.find((element) => element.id === 'bottom-panel');

    expect(panel).toBeDefined();
    expect(validateMatchLayout(layout)).toEqual([]);
    if (!panel) return;
    expect(panel.x).toBe(0);
    expect(panel.y + panel.height).toBe(height);
    expect(panel.width).toBe(width);
  });

  it('разделяет padding dock и видимый отступ карточек на ПК', () => {
    expect(armyBarCss).toContain('padding: 0 var(--space-lg) var(--space-sm);');
    expect(armyBarCss).toContain('@media (min-width: 601px)');
    expect(armyBarCss).toMatch(
      /@media \(min-width: 601px\)\s*\{\s*\.strip\s*\{\s*margin-bottom: var\(--space-sm\);/s,
    );
  });

  it('не связывает нижнюю панель с высотой карточки или лидерборда', () => {
    const base = {
      viewport: { width: 1440, height: 900 },
      hudHeight: 88,
      bottomPanelHeight: 150,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: true,
      leaderboardRows: 5,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    } as const;
    const first = computeMatchLayout({ ...base, cardHeight: 44 });
    const second = computeMatchLayout({ ...base, cardHeight: 320 });
    const panel = (layout: ReturnType<typeof computeMatchLayout>) =>
      layout.elements.find((element) => element.id === 'bottom-panel');

    expect(panel(first)).toEqual(panel(second));
  });
});
