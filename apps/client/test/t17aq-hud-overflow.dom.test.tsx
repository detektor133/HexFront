import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Hud } from '../src/dev/Hud.tsx';
import { createLocalEngine } from '../src/local/engine.ts';

const hudCss = readFileSync(join(process.cwd(), 'apps/client/src/dev/Hud.module.css'), 'utf8');
const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

function renderHud(width: number): HTMLElement {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const style = document.createElement('style');
  style.dataset.t17aqHudCss = 'true';
  style.textContent = hudCss.replace(
    /\.(hud|slot|taxWrap|taxButton|slotText|rate|value|settingsWrap|settingsButton)\b/gu,
    '[class*="$1"]',
  );
  document.head.append(style);
  render(
    <Hud
      view={engine.snapshot().view}
      send={vi.fn()}
      fog={false}
      setFog={vi.fn()}
      onPause={vi.fn()}
    />,
  );
  const hud = document.querySelector<HTMLElement>('header');
  if (!hud) throw new Error('HUD не найден');
  return hud;
}

function getApplicableDeclarations(node: Element, width: number): CSSStyleDeclaration[] {
  const applies = (query: string): boolean => {
    const maxWidth = query.match(/\(max-width:\s*(\d+)px\)/u)?.[1];
    const minWidth = query.match(/\(min-width:\s*(\d+)px\)/u)?.[1];
    return (!maxWidth || width <= Number(maxWidth)) && (!minWidth || width >= Number(minWidth));
  };
  const collect = (rules: CSSRuleList): CSSStyleDeclaration[] =>
    Array.from(rules).flatMap((rule) => {
      if (rule instanceof CSSStyleRule) {
        return node.matches(rule.selectorText) ? [rule.style] : [];
      }
      if (rule instanceof CSSMediaRule && !applies(rule.conditionText)) return [];
      return 'cssRules' in rule ? collect((rule as CSSGroupingRule).cssRules) : [];
    });
  return Array.from(document.styleSheets)
    .filter(
      (sheet) => sheet.ownerNode instanceof HTMLStyleElement && sheet.ownerNode.dataset.t17aqHudCss,
    )
    .flatMap((sheet) => collect(sheet.cssRules));
}

afterEach(() => {
  cleanup();
  document.querySelector('[data-t17aq-hud-css]')?.remove();
  vi.restoreAllMocks();
});

describe('07/T17aq: верхняя панель без переполнения', () => {
  it('на 768, 1024, 1366 и 1920 px сохраняет видимые группы без пересечений', () => {
    for (const width of [768, 1024, 1366, 1920]) {
      const hud = renderHud(width);
      const groups = Array.from(hud.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      expect(groups).toHaveLength(8);
      const hudRect = hud.getBoundingClientRect();
      let previousRight = hudRect.left;
      for (const group of groups) {
        const isMetricGroup =
          group.className.toString().includes('slot') ||
          group.className.toString().includes('taxWrap');
        const icon = group.querySelector<SVGElement>('svg');
        const value = group.querySelector<HTMLElement>('[class*="slotText"]');
        const growth = group.querySelector<HTMLElement>('[class*="rate"]');
        if (isMetricGroup) {
          expect(icon?.getAttribute('aria-label')).toBeTruthy();
          expect(value?.textContent).not.toBe('');
        }
        if (group.className.toString().includes('slot')) {
          expect(growth?.textContent).not.toBe('');
        }
        const rect = group.getBoundingClientRect();
        expect(rect.width).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(hudRect.right);
        expect(rect.left).toBeGreaterThanOrEqual(previousRight);
        const children = isMetricGroup ? [value, growth] : [];
        for (const child of children) {
          if (!child) continue;
          const childRect = child.getBoundingClientRect();
          if (childRect.width === 0 && childRect.height === 0) continue;
          expect(childRect.width).toBeGreaterThan(0);
          expect(childRect.height).toBeGreaterThan(0);
          expect(childRect.left).toBeGreaterThanOrEqual(rect.left);
          expect(childRect.right).toBeLessThanOrEqual(rect.right);
        }
        previousRight = rect.right;
      }
      expect(hud.scrollWidth).toBeLessThanOrEqual(hud.clientWidth || width);
      cleanup();
    }
  });

  it('у taxButton нет постоянной границы и радиуса, интерактивные состояния разрешены, поповер открывается', () => {
    renderHud(1024);
    const taxButton = screen.getByRole('button', { name: 'Налог' });
    expect(hudCss).toMatch(/\.taxButton\s*\{[\s\S]*?border: 0;/u);
    expect(hudCss).toMatch(/\.taxButton\s*\{[\s\S]*?border-radius: 0;/u);
    expect(hudCss).toMatch(/\.hudInteractive:hover\s*\{[\s\S]*?background: var\(--ui-surface2\);/u);
    expect(hudCss).toMatch(
      /\.hudInteractive:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--selection-color\);/u,
    );
    expect(taxButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(taxButton);
    expect(screen.getByRole('dialog', { name: 'Налог' })).toBeTruthy();
  });

  it('на 360 px применяет мобильные ограничения, сохраняет одну строку и приросты', () => {
    const hud = renderHud(360);
    const hudDeclarations = getApplicableDeclarations(hud, 360);
    expect(
      hudDeclarations.some((style) => style.padding === 'var(--space-xs) var(--space-xs)'),
    ).toBe(true);
    expect(hudDeclarations.some((style) => style.flexWrap === 'nowrap')).toBe(true);
    const metricGroup = hud.querySelector<HTMLElement>('[class*="slot"]');
    const slotText = metricGroup?.querySelector<HTMLElement>('[class*="slotText"]');
    expect(metricGroup).not.toBeNull();
    expect(slotText).not.toBeNull();
    const metricDeclarations = getApplicableDeclarations(metricGroup as HTMLElement, 360);
    const textDeclarations = getApplicableDeclarations(slotText as HTMLElement, 360);
    expect(
      metricDeclarations.some(
        (style) => /^1 1 0(?:px)?$/u.test(style.flex) && /^0(?:px)?$/u.test(style.minWidth),
      ),
    ).toBe(true);
    expect(metricDeclarations.some((style) => style.gap === '2px')).toBe(true);
    expect(textDeclarations.some((style) => style.transform === 'scaleX(0.6)')).toBe(true);
    expect(textDeclarations.some((style) => /^0(?:px)?$/u.test(style.gap))).toBe(true);
    const taxWrap = hud.querySelector<HTMLElement>('[class*="taxWrap"]');
    const taxButton = hud.querySelector<HTMLElement>('[class*="taxButton"]');
    expect(taxWrap).not.toBeNull();
    expect(taxButton).not.toBeNull();
    const taxWrapDeclarations = getApplicableDeclarations(taxWrap as HTMLElement, 360);
    const taxButtonDeclarations = getApplicableDeclarations(taxButton as HTMLElement, 360);
    const getEffective = (
      declarations: CSSStyleDeclaration[],
      property: 'minWidth' | 'padding',
    ): string =>
      [...declarations].reverse().find((style) => style[property] !== '')?.[property] ?? '';
    expect(getEffective(taxWrapDeclarations, 'minWidth')).toMatch(/^0(?:px)?$/u);
    expect(getEffective(taxWrapDeclarations, 'padding')).toBe('');
    expect(getEffective(taxButtonDeclarations, 'minWidth')).toBe('var(--touch-target-min)');
    expect(
      taxButtonDeclarations
        .map((style) => style.padding)
        .filter((padding) => padding !== '')
        .every((padding) =>
          /^(?:0(?:px)? (?:2px|var\(--space-(?:xs|sm|md|lg)\))|var\(--space-(?:xs|md)\)(?: var\(--space-xs\))?|0|2px)$/u.test(
            padding,
          ),
        ),
    ).toBe(true);
    expect(
      Array.from(hud.children).filter((element) => element.className.toString().includes('slot')),
    ).toHaveLength(5);
    const flexibleGroups = Array.from(hud.children).filter(
      (element) =>
        element.className.toString().includes('slot') ||
        element.className.toString().includes('taxWrap'),
    );
    expect(flexibleGroups).toHaveLength(6);
    for (const group of flexibleGroups) {
      const declarations = getApplicableDeclarations(group, 360);
      const getEffective = (property: 'flex' | 'minWidth' | 'padding'): string =>
        [...declarations].reverse().find((style) => style[property] !== '')?.[property] ?? '';
      expect(getEffective('flex')).toMatch(/^1 1 0(?:px)?$/u);
      if (group.className.toString().includes('slot')) {
        expect(getEffective('minWidth')).toMatch(/^0(?:px)?$/u);
        expect(getEffective('padding')).toBe('');

        const text = group.querySelector<HTMLElement>('[class*="slotText"]');
        expect(text?.textContent).not.toBe('');
        const contentWidth = 14 + (text?.textContent?.length ?? 0);
        const availableWidth = (360 - 2 * 8 - 2 * 44) / 6;
        expect(contentWidth).toBeLessThanOrEqual(availableWidth);
      }
    }
    const settingsWrap = hud.querySelector<HTMLElement>('[class*="settingsWrap"]');
    expect(settingsWrap).not.toBeNull();
    const settingsDeclarations = getApplicableDeclarations(settingsWrap as HTMLElement, 360);
    expect(settingsDeclarations.some((style) => style.flex === '0 0 var(--touch-target-min)')).toBe(
      true,
    );
    expect(hud.querySelectorAll('[class*="rate"]').length).toBeGreaterThanOrEqual(2);
    expect(hud.textContent).toContain('%');
    expect(hud.textContent).toMatch(/#\d+/u);
  });
});
