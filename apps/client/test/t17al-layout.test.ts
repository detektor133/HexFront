import { describe, expect, it } from 'vitest';

import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const baseInput = (width: number, height: number) => ({
  viewport: { width, height },
  hudHeight: 88,
  bottomPanelHeight: 150,
  eventRows: 1,
  tutorialVisible: false,
  leaderboardOpen: false,
  leaderboardRows: 0,
  cardHeight: 300,
  cardOpen: false,
  popupOpen: false,
  paused: false,
});

describe('T17al: раскладка ленты событий', () => {
  it('ставит ленту у правого нижнего угла над нижней панелью', () => {
    for (const [width, height] of [
      [1280, 720],
      [1366, 768],
      [1440, 900],
      [1920, 1080],
      [390, 844],
      [844, 390],
    ] as const) {
      const layout = computeMatchLayout(baseInput(width, height));
      const feed = layout.elements.find((element) => element.id === 'event-feed');
      const dock = layout.elements.find((element) => element.id === 'bottom-panel');
      expect(feed, `${width}x${height}`).toBeDefined();
      if (!feed) continue;
      expect(feed.x + feed.width).toBe(width - (width <= 600 || height <= 500 ? 8 : 16));
      expect(feed.y + feed.height).toBe((dock?.y ?? height) - 8);
      expect(validateMatchLayout(layout)).toEqual([]);
    }
  });

  it('сохраняет высоту ленты по числу строк', () => {
    for (const eventRows of [1, 2, 3]) {
      const layout = computeMatchLayout({ ...baseInput(1440, 900), eventRows });
      expect(layout.elements.find((element) => element.id === 'event-feed')?.height).toBe(
        eventRows * 44,
      );
    }
  });

  it('оставляет онбординг слева при отсутствии событий', () => {
    const layout = computeMatchLayout({
      ...baseInput(1440, 900),
      eventRows: 0,
      tutorialVisible: true,
    });
    const hints = layout.elements.find((element) => element.id === 'left-column');
    expect(hints).toMatchObject({ x: 16, y: 96, height: 48 });
    expect(layout.elements.some((element) => element.id === 'event-feed')).toBe(false);
  });
});
