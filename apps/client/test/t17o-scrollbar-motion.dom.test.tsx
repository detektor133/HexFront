import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const cssSources = [
  readFileSync(join(process.cwd(), 'apps/client/src/dev/Leaderboard.module.css'), 'utf8'),
  readFileSync(join(process.cwd(), 'apps/client/src/dev/HexCard.module.css'), 'utf8'),
];

function installPanelStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `:root { --motion-easing: cubic-bezier(0.22, 1, 0.36, 1); }\n${cssSources.join('\n')}`;
  document.head.append(style);
  return style;
}

function addScrollableNode(className: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  Object.defineProperties(node, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 180 },
  });
  document.body.append(node);
  return node;
}

afterEach(() => {
  document.head.querySelector('style')?.remove();
  document.body.replaceChildren();
});

describe('07/T17o: прокрутка и движение панелей', () => {
  it('скрывает нативный скроллбар, сохраняя переполненную прокрутку', () => {
    installPanelStyles();

    for (const className of ['panel', 'card']) {
      const node = addScrollableNode(className);
      const style = getComputedStyle(node);

      expect(node.scrollHeight).toBeGreaterThan(node.clientHeight);
      if (className === 'panel') {
        expect(style.overflowY).not.toMatch(/auto|scroll/u);
      } else {
        expect(style.overflowY).toBe('auto');
        expect(style.scrollbarWidth).toBe('none');
      }

      node.scrollTop = 40;
      expect(node.scrollTop).toBe(40);
    }
  });

  it('не анимирует изменение высоты и позиции карточки', () => {
    installPanelStyles();

    const transition = getComputedStyle(addScrollableNode('card')).transition;

    expect(transition).not.toMatch(/top|height/u);
  });

  it('ограничивает карточку вычисленной раскладкой на целевых экранах', () => {
    for (const viewport of [
      { width: 360, height: 640 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      let previousCardHeight: number | undefined;

      for (const cardHeight of [44, 120, viewport.height]) {
        const layout = computeMatchLayout({
          viewport,
          hudHeight: viewport.width <= 600 ? 44 : 48,
          bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
          eventRows: 0,
          tutorialVisible: false,
          leaderboardOpen: false,
          leaderboardRows: 0,
          cardHeight,
          cardOpen: true,
          popupOpen: false,
          paused: false,
        });
        const card = layout.elements.find((element) => element.id === 'card');

        expect(card).toBeDefined();
        expect(validateMatchLayout(layout)).toEqual([]);
        expect(card?.y).toBeGreaterThanOrEqual(layout.hudHeight + 8);
        expect((card?.y ?? 0) + (card?.height ?? 0)).toBeLessThanOrEqual(
          viewport.height - layout.bottomPanelHeight - 8,
        );
        if (previousCardHeight !== undefined) {
          expect(card?.height).not.toBe(previousCardHeight);
        }
        previousCardHeight = card?.height;
      }
    }
  });
});
