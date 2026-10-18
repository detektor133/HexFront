import { describe, expect, it } from 'vitest';

import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const viewports = [
  { width: 360, height: 640 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

describe('07/T17i: раскладка лидерборда', () => {
  it('ограничивает высоту пятью отображаемыми строками, а не числом игроков', () => {
    for (const viewport of viewports) {
      const layout = computeMatchLayout({
        viewport,
        hudHeight: viewport.width <= 600 ? 44 : 48,
        bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: true,
        leaderboardRows: 30,
        leaderboardPlayerNames: Array.from({ length: 30 }, (_, id) => `Player ${id + 1}`),
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      });
      const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');

      expect(leaderboard).toMatchObject({ height: 244 });
      expect(validateMatchLayout(layout)).toEqual([]);
    }
  });

  it('не меняет высоту содержимого из-за экрана и нижней панели', () => {
    const layouts = [
      computeMatchLayout({
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
      }),
      computeMatchLayout({
        viewport: { width: 360, height: 300 },
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
      }),
      computeMatchLayout({
        viewport: { width: 360, height: 640 },
        hudHeight: 44,
        bottomPanelHeight: 500,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: true,
        leaderboardRows: 5,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      }),
    ];

    for (const layout of layouts) {
      expect(layout.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
        height: 244,
      });
    }
  });

  it('на телефоне занимает ширину экрана между отступами, а на ПК — 320 px', () => {
    const phone = computeMatchLayout({
      viewport: { width: 360, height: 640 },
      hudHeight: 44,
      bottomPanelHeight: 178,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: true,
      leaderboardRows: 30,
      leaderboardPlayerNames: Array.from({ length: 30 }, (_, id) => `Player ${id + 1}`),
      cardHeight: 0,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });
    const desktop = computeMatchLayout({
      viewport: { width: 1440, height: 900 },
      hudHeight: 48,
      bottomPanelHeight: 132,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: true,
      leaderboardRows: 30,
      leaderboardPlayerNames: Array.from(
        { length: 30 },
        (_, id) => `Very long player name ${id + 1}`,
      ),
      cardHeight: 0,
      cardOpen: false,
      popupOpen: false,
      paused: false,
    });

    expect(phone.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      x: 8,
      width: 344,
      y: 52,
    });
    const desktopLeaderboard = desktop.elements.find((element) => element.id === 'leaderboard');
    expect(desktopLeaderboard?.width).toBeLessThanOrEqual(320);
    expect(desktopLeaderboard?.width).toBeGreaterThan(160);
    expect(desktopLeaderboard?.x).toBe(1440 - 16 - (desktopLeaderboard?.width ?? 0));
    expect(desktopLeaderboard?.y).toBe(56);
  });

  it('сохраняет компактную ширину и высоту на всех целевых ПК viewport', () => {
    const names = ['Very long player name 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];
    const layouts = [
      computeMatchLayout({
        viewport: { width: 1366, height: 768 },
        hudHeight: 48,
        bottomPanelHeight: 132,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: true,
        leaderboardRows: 5,
        leaderboardPlayerNames: names,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      }),
      computeMatchLayout({
        viewport: { width: 1440, height: 900 },
        hudHeight: 48,
        bottomPanelHeight: 240,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: true,
        leaderboardRows: 5,
        leaderboardPlayerNames: names,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      }),
      computeMatchLayout({
        viewport: { width: 1920, height: 1080 },
        hudHeight: 48,
        bottomPanelHeight: 420,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: true,
        leaderboardRows: 5,
        leaderboardPlayerNames: names,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      }),
    ];
    const leaderboards = layouts.map((layout) =>
      layout.elements.find((element) => element.id === 'leaderboard'),
    );
    expect(leaderboards.every((leaderboard) => leaderboard?.width === leaderboards[0]?.width)).toBe(
      true,
    );
    expect(leaderboards.every((leaderboard) => leaderboard?.height === 244)).toBe(true);
    expect(
      leaderboards.every((leaderboard, index) => {
        const layout = layouts[index];
        return (
          layout !== undefined &&
          leaderboard !== undefined &&
          leaderboard.x === layout.viewport.width - 16 - leaderboard.width
        );
      }),
    ).toBe(true);
    expect(leaderboards[0]?.width).toBeLessThanOrEqual(320);
    expect(leaderboards[0]?.width).toBeGreaterThan(160);
  });

  it('определяет ширину по компактному содержимому и ограничивает её максимумом', () => {
    const createLayout = (names: readonly string[]) =>
      computeMatchLayout({
        viewport: { width: 1440, height: 900 },
        hudHeight: 48,
        bottomPanelHeight: 132,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: true,
        leaderboardRows: names.length,
        leaderboardPlayerNames: names,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      });
    const compact = createLayout(['А', 'Б', 'В', 'Г', 'Д']).elements.find(
      (element) => element.id === 'leaderboard',
    );
    const expanded = createLayout([
      'Очень длинное имя игрока 1',
      'Очень длинное имя игрока 2',
      'Очень длинное имя игрока 3',
      'Очень длинное имя игрока 4',
      'Очень длинное имя игрока 5',
    ]).elements.find((element) => element.id === 'leaderboard');

    expect(compact).toBeDefined();
    expect(expanded).toBeDefined();
    expect(compact?.width).toBeLessThan(expanded?.width ?? 0);
    expect(expanded?.width).toBeLessThanOrEqual(320);
    expect(compact?.x).toBe(1440 - 16 - (compact?.width ?? 0));
    expect(expanded?.x).toBe(1440 - 16 - (expanded?.width ?? 0));
  });

  it('оставляет свёрнутую кнопку справа сверху на всех целевых экранах', () => {
    for (const viewport of viewports) {
      const layout = computeMatchLayout({
        viewport,
        hudHeight: viewport.width <= 600 ? 44 : 48,
        bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: false,
        leaderboardRows: 30,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      });
      const leaderboard = layout.elements.find((element) => element.id === 'leaderboard');

      expect(leaderboard).toMatchObject({
        x: viewport.width - (viewport.width <= 600 ? 8 : 16) - 180,
        y: viewport.width <= 600 ? 52 : 56,
        width: 180,
        height: 44,
      });
    }
  });
});
