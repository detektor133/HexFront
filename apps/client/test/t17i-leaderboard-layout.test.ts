import { describe, expect, it } from 'vitest';

import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const viewports = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

function layoutFor(
  viewport: { readonly width: number; readonly height: number },
  overrides: Partial<Parameters<typeof computeMatchLayout>[0]> = {},
) {
  return computeMatchLayout({
    viewport,
    hudHeight: viewport.width <= 600 ? 44 : 48,
    bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
    eventRows: 0,
    tutorialVisible: false,
    leaderboardOpen: true,
    leaderboardRows: 5,
    cardHeight: 0,
    cardOpen: false,
    popupOpen: false,
    paused: false,
    ...overrides,
  });
}

describe('07/T17i: раскладка лидерборда', () => {
  it('использует измеренную высоту пяти строк, а не число игроков', () => {
    for (const viewport of viewports) {
      const layout = layoutFor(viewport, { leaderboardRows: 30 });
      const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');

      expect(leaderboard).toBeDefined();
      expect(leaderboard?.x).toBe(viewport.width - 16);
      expect(validateMatchLayout(layout)).toEqual([]);
    }

    const phone = computeMatchLayout({
      viewport: { width: 360, height: 640 },
      hudHeight: 44,
      bottomPanelHeight: 178,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: true,
      leaderboardRows: 30,
      cardHeight: 0,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });
    expect(phone.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      width: 344,
      height: 246,
    });
  });

  it('применяет естественный размер панели, измеренный по трём полям', () => {
    const layouts = [2, 5, 30].map((leaderboardRows) =>
      layoutFor({ width: 1440, height: 900 }, { leaderboardRows }),
    );

    for (const layout of layouts) {
      const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');
      expect(leaderboard).toBeDefined();
      expect(leaderboard?.x).toBe(1440 - 16);
      expect(leaderboard?.width).toBe(0);
      expect(leaderboard?.height).toBe(0);
    }
  });

  it('не меняет измеренный размер при смене viewport и сохраняет правую привязку', () => {
    const layouts = viewports.map((viewport) => layoutFor(viewport));
    const leaderboards = layouts.map((layout) =>
      layout.elements.find((element) => element.id === 'leaderboard'),
    );

    expect(leaderboards.every((leaderboard) => leaderboard?.width === 0)).toBe(true);
    expect(leaderboards.every((leaderboard) => leaderboard?.height === 0)).toBe(true);
    expect(
      leaderboards.every((leaderboard, index) => {
        const viewport = viewports[index];
        return viewport !== undefined && leaderboard?.x === viewport.width - 16;
      }),
    ).toBe(true);
  });

  it('на телефоне сохраняет действующую полноширинную раскладку', () => {
    const layout = computeMatchLayout({
      viewport: { width: 360, height: 640 },
      hudHeight: 44,
      bottomPanelHeight: 178,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: true,
      leaderboardRows: 5,
      cardHeight: 0,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });

    expect(layout.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      x: 8,
      width: 344,
      y: 52,
      height: 246,
    });
  });
});
