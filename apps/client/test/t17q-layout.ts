import { readFileSync } from 'node:fs';

import { expect } from 'vitest';

import { computeMatchLayout } from '../src/match/layout.ts';

export function panel(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[class*="dock"]');
  if (!element) throw new Error('панель армий не найдена');
  return element;
}

export function panelStyle(): string[] {
  return ['left', 'top', 'width', 'height'].map((property) =>
    panel().style.getPropertyValue(property),
  );
}

export function expectedPanelStyle(
  width: number,
  height: number,
  bottomPanelHeight = 150,
  cardHeight = 0,
  leaderboardRows = 2,
  popupOpen = false,
): string[] {
  const layout = computeMatchLayout({
    viewport: { width, height },
    hudHeight: 88,
    bottomPanelHeight,
    eventRows: 0,
    tutorialVisible: true,
    leaderboardOpen: width > 600,
    leaderboardRows,
    cardHeight,
    cardOpen: cardHeight > 0,
    popupOpen,
    paused: false,
  });
  const element = layout.elements.find((item) => item.id === 'bottom-panel');
  if (!element) throw new Error('нижняя панель не попала в раскладку');
  return [element.x, element.y, element.width, element.height].map((value) => `${value}px`);
}

export function expectDockPadding(): void {
  const style = getComputedStyle(panel());
  const strip = panel().querySelector<HTMLElement>('[class*="strip"]');
  if (!strip) throw new Error('Лента армий не найдена');
  const stripStyle = getComputedStyle(strip);
  const source = readFileSync('apps/client/src/dev/ArmyBar.module.css', 'utf8');
  expect(source).toMatch(/padding: 0 var\(--space-lg\) var\(--space-sm\);/u);
  expect(source).toMatch(/padding: 0 var\(--space-sm\) var\(--space-sm\);/u);
  if (window.innerWidth > 600) {
    expect(style.paddingBottom).toBe('8px');
    expect(style.paddingLeft).toBe('16px');
    expect(stripStyle.marginBottom).toBe('8px');
  }
  const tokens = readFileSync('docs/art/tokens.json', 'utf8');
  const spaceSm = Number.parseInt(tokens.match(/"sm":\s*(\d+)/u)?.[1] ?? '', 10);
  const spaceLg = Number.parseInt(tokens.match(/"lg":\s*(\d+)/u)?.[1] ?? '', 10);
  expect(spaceSm + spaceSm).toBe(spaceLg);
  expect(source).toMatch(/\.strip\s*\{[\s\S]*?margin-bottom: var\(--space-sm\);/u);
  expect(readFileSync('docs/art/tokens.json', 'utf8')).toMatch(/"lg": 16/u);
  expect(readFileSync('docs/art/tokens.json', 'utf8')).toMatch(/"sm": 8/u);
  expect(source).not.toMatch(/position:\s*fixed/u);
}

export function expectElementStyle(
  elementId: string,
  input: Parameters<typeof computeMatchLayout>[0],
): void {
  const element = computeMatchLayout(input).elements.find((item) => item.id === elementId);
  if (!element) throw new Error(`элемент раскладки ${elementId} не найден`);
  const node =
    elementId === 'card'
      ? document.querySelector<HTMLElement>('section[class*="card"]')
      : document.querySelector<HTMLElement>('[class*="dock"]');
  if (!node) throw new Error(`DOM-элемент ${elementId} не найден`);
  expect(
    ['left', 'top', 'width', 'height'].map((property) => node.style.getPropertyValue(property)),
  ).toEqual([
    `${element.x}px`,
    `${element.y}px`,
    elementId === 'card' && input.viewport.width > 600 && input.viewport.height > 500
      ? ''
      : `${element.width}px`,
    `${element.height}px`,
  ]);
}
