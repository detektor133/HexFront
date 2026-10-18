import { describe, expect, it } from 'vitest';

import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const viewports = [
  { width: 360, height: 640 },
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
    expect(desktop.elements.find((element) => element.id === 'leaderboard')).toMatchObject({
      x: 1186,
      width: 238,
      y: 56,
    });
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
