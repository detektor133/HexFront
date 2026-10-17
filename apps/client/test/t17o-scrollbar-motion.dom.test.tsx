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
      expect(style.overflowY).toBe('auto');
      expect(style.scrollbarWidth).toBe('none');
    }
  });

  it('анимирует изменение высоты и позиции панели UI-motion токенами', () => {
    installPanelStyles();

    for (const className of ['panel', 'card']) {
      const transition = getComputedStyle(addScrollableNode(className)).transition;

      expect(transition).toContain('150ms');
      expect(transition).toMatch(/var\(--motion-easing\)|cubic-bezier\(0\.22, 1, 0\.36, 1\)/u);
      expect(transition).toContain('top');
      expect(transition).toContain('height');
    }
  });

  it('ограничивает карточку вычисленной раскладкой на целевых экранах', () => {
    for (const viewport of [
      { width: 360, height: 640 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      const layout = computeMatchLayout({
        viewport,
        hudHeight: viewport.width <= 600 ? 44 : 48,
        bottomPanelHeight: viewport.width <= 600 ? 178 : 132,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: false,
        leaderboardRows: 0,
        cardHeight: viewport.height,
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
    }
  });
});
