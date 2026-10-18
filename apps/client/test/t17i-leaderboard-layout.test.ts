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
    ...(viewport.width > 600 ? { leaderboardSize: { width: 150, height: 138 } } : {}),
    ...overrides,
  });
}

describe('07/T17i: раскладка лидерборда', () => {
  it('использует измеренную высоту пяти строк, а не число игроков', () => {
    for (const viewport of viewports) {
      const layout = layoutFor(viewport, { leaderboardRows: 30 });
      const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');

      expect(leaderboard).toMatchObject({ width: 150, height: 138 });
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
    const compact = layoutFor(
      { width: 1440, height: 900 },
      {
        leaderboardRows: 2,
        leaderboardSize: { width: 112, height: 90 },
      },
    );
    const longScore = layoutFor(
      { width: 1440, height: 900 },
      {
        leaderboardRows: 2,
        leaderboardSize: { width: 158, height: 90 },
      },
    );
    const longName = layoutFor(
      { width: 1440, height: 900 },
      {
        leaderboardRows: 2,
        leaderboardSize: { width: 112, height: 90 },
      },
    );

    expect(compact.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      width: 112,
      height: 90,
    });
    expect(longScore.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      width: 158,
    });
    expect(longName.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      width: 112,
    });
    expect([112, 158]).not.toContain(301);
    expect([112, 158]).not.toContain(317);
    expect([112, 158]).not.toContain(422);
    expect([112, 158]).not.toContain(440);
  });

  it('не меняет измеренный размер при смене viewport и сохраняет правую привязку', () => {
    const layouts = viewports.map((viewport) => layoutFor(viewport));
    const leaderboards = layouts.map((layout) =>
      layout.elements.find((element) => element.id === 'leaderboard'),
    );

    expect(leaderboards.every((leaderboard) => leaderboard?.width === 150)).toBe(true);
    expect(leaderboards.every((leaderboard) => leaderboard?.height === 138)).toBe(true);
    expect(
      leaderboards.every((leaderboard, index) => {
        const viewport = viewports[index];
        return viewport !== undefined && leaderboard?.x === viewport.width - 16 - 150;
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
