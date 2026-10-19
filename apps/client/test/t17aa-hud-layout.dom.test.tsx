import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { fp } from '@hexfront/sim';

import { Hud } from '../src/dev/Hud.tsx';
import { createLocalEngine } from '../src/local/engine.ts';

const hudCss = readFileSync(join(process.cwd(), 'apps/client/src/dev/Hud.module.css'), 'utf8');
const uiDoc = readFileSync(join(process.cwd(), 'docs/art/ui.md'), 'utf8');
const styleGuide = readFileSync(join(process.cwd(), 'docs/art/style-guide.md'), 'utf8');

function cssBlock(selector: string): string {
  const start =
    selector === '.taxButton'
      ? hudCss.indexOf('\n.taxButton {\n  /* Подпись')
      : hudCss.indexOf(`\n${selector} {`);
  if (start < 0) return '';
  const end = hudCss.indexOf('\n}', start);
  return hudCss.slice(start, end < 0 ? hudCss.length : end);
}

describe('07/T17aa: HUD без переполнения', () => {
  it('ограничивает содержимое всех пяти слотов и отдельно проверяет налог', () => {
    expect(hudCss.match(/\.hud > \.slot/g)).toHaveLength(1);
    expect(hudCss).toMatch(/\.slot,\s*\.taxButton\s*\{/);
    expect(cssBlock('.slotText')).toContain('overflow: hidden;');
    expect(cssBlock('.slotText')).toContain('text-overflow: ellipsis;');
    expect(cssBlock('.slotText')).toContain('min-width: 0;');

    const taxButton = cssBlock('.taxButton');
    expect(taxButton).toContain('border: 0;');
    expect(taxButton).toContain('border-radius: 0;');
    expect(taxButton).toContain('background: none;');
  });

  it('использует единый интерактивный класс и фиксирует стратегию в документации', () => {
    expect(hudCss).toMatch(/\.hudInteractive:hover\s*\{[\s\S]*?background: var\(--ui-surface2\);/);
    expect(hudCss).toMatch(
      /\.hudInteractive:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--selection-color\);/,
    );
    expect(uiDoc).toContain('длинные значения сокращаются многоточием внутри слота');
    expect(styleGuide).toContain('налога использует общий интерактивный класс HUD');
  });
});

describe('07/T17aa real Hud layout', () => {
  afterEach(() => {
    cleanup();
    document.querySelector('[data-t17aa-hud-css]')?.remove();
  });

  it('measures long values at 1280, 1366, 1440 and 1920', () => {
    const mapJson: unknown = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
    );
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot().view;
    const longView = {
      ...source,
      players: source.players.map((player) => ({ ...player, gold: fp(1234567890123) })),
      me: {
        ...source.me,
        popTotal: 1234567890123,
        popGrowthPerS: 123456789,
        incomePerS: 987654321,
        upkeepPerS: 123456789,
      },
    };

    const style = document.createElement('style');
    style.dataset.t17aaHudCss = 'true';
    style.textContent = hudCss.replace(
      /\.(hud|slotText|slot|taxWrap|taxButton|settingsWrap|settingsButton|hudInteractive)\b/g,
      '[class*="$1"]',
    );
    document.head.append(style);

    for (const viewportWidth of [1280, 1366, 1440, 1920]) {
      const view = render(
        <Hud
          view={longView}
          send={() => undefined}
          fog={false}
          setFog={() => undefined}
          style={{ width: `${viewportWidth}px`, left: 0, top: 0 }}
          onPause={() => undefined}
        />,
      );
      const settingsButton = view.container.querySelector<HTMLElement>('[class*="settingsButton"]');
      if (!settingsButton) throw new Error('Кнопка настроек HUD не найдена');
      const hud = document.querySelector<HTMLElement>('header');
      if (!hud) throw new Error('Hud не найден');
      const directChildren = Array.from(hud.children) as HTMLElement[];
      const slots = directChildren.filter((element) => element.className.includes('slot'));
      const taxWrap = directChildren.find((element) => element.className.includes('taxWrap'));
      const taxButton = taxWrap?.querySelector<HTMLElement>('[class*="taxButton"]');
      if (!taxWrap || !taxButton) throw new Error('Налоговая кнопка не найдена');
      expect(slots).toHaveLength(5);
      const hudRect = hud.getBoundingClientRect();
      const assertInsideHud = (element: HTMLElement): void => {
        const rect = element.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(hudRect.left);
        expect(rect.right).toBeLessThanOrEqual(hudRect.right);
        expect(translateX(element)).toBe(0);
      };

      const explicitTextWidth = Number.parseFloat(
        cssBlock('.slotText').match(/(?:^|\n)\s*width:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? '',
      );
      const hudStyle = getComputedStyle(hud);
      const hudWidth = Number.parseFloat(hudStyle.width);
      const paddingLeft = Number.parseFloat(hudStyle.paddingLeft) || 16;
      const paddingRight = Number.parseFloat(hudStyle.paddingRight) || 16;
      const itemWidth = (hudWidth - paddingLeft - paddingRight) / 6;
      expect(hudWidth).toBe(viewportWidth);
      expect(Number.isFinite(itemWidth)).toBe(true);
      if (Number.isFinite(explicitTextWidth)) {
        expect(explicitTextWidth).toBeLessThanOrEqual(itemWidth - 14);
      }

      const translateX = (element: HTMLElement): number => {
        const style = getComputedStyle(element);
        const transform = style.transform.match(
          /^matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([^,]+),/,
        );
        const translated = style.transform.match(/^translateX\((-?[\d.]+)px\)$/);
        const left = style.left === 'auto' || style.left === '' ? 0 : Number.parseFloat(style.left);
        return (
          (transform
            ? Number.parseFloat(transform[1] ?? '0')
            : translated
              ? Number.parseFloat(translated[1] ?? '0')
              : 0) + left
        );
      };

      const layoutBounds = (
        index: number,
        element: HTMLElement,
      ): { left: number; right: number } => ({
        left: paddingLeft + index * itemWidth + translateX(element),
        right: paddingLeft + (index + 1) * itemWidth + translateX(element),
      });
      expect(hudCss).not.toMatch(
        /\.slot,\s*\.taxButton\s*\{[^}]*?(?:transform|position|left|right)\s*:/s,
      );

      for (const [index, element] of [...slots, taxWrap].entries()) {
        assertInsideHud(element);
        const bounds = layoutBounds(index, element);
        expect(bounds.left).toBeGreaterThanOrEqual(paddingLeft);
        expect(bounds.right).toBeLessThanOrEqual(viewportWidth - paddingRight);
        expect(getComputedStyle(element).position).toBe(
          element === taxWrap ? 'relative' : 'static',
        );

        for (const child of Array.from(element.querySelectorAll('*'))) {
          const childElement = child as HTMLElement;
          const childStyle = getComputedStyle(childElement);
          expect(childStyle.position).not.toBe('fixed');
          expect(translateX(childElement)).toBe(0);
          if (childElement.className.toString().includes('slotText')) {
            expect(childElement.textContent?.length ?? 0).toBeGreaterThan(0);
          }
        }
      }
      assertInsideHud(taxButton);
      const taxButtonStyle = getComputedStyle(taxButton);
      const taxButtonWidth = Number.parseFloat(taxButtonStyle.width);
      const taxButtonBasis = Number.parseFloat(taxButtonStyle.flexBasis);
      const measuredTaxButtonWidth = Number.isFinite(taxButtonWidth)
        ? taxButtonWidth
        : Number.isFinite(taxButtonBasis)
          ? taxButtonBasis
          : 0;
      expect(measuredTaxButtonWidth).toBeLessThanOrEqual(itemWidth);
      for (const child of Array.from(hud.querySelectorAll('*')) as HTMLElement[]) {
        assertInsideHud(child);
      }

      const taxContent = taxButton.querySelector<HTMLElement>('[class*="slotText"]');
      if (!taxContent) throw new Error('Содержимое налога не найдено');
      expect(taxContent.textContent?.length ?? 0).toBeGreaterThan(0);
      for (const content of [
        ...slots.map((slot) => slot.querySelector<HTMLElement>('[class*="slotText"]')),
        taxContent,
      ]) {
        if (!content) throw new Error('Содержимое слота не найдено');
        const rect = content.getBoundingClientRect();
        const computed = getComputedStyle(content);
        const flexBasis = Number.parseFloat(computed.flexBasis);
        const measuredWidth = rect.width || (Number.isFinite(flexBasis) ? flexBasis : 0);
        expect(measuredWidth).toBeLessThanOrEqual(itemWidth);
      }
      for (const element of slots.slice(0, 2)) {
        const content = element.querySelector<HTMLElement>('[class*="slotText"]');
        if (!content) throw new Error('Длинное содержимое слота не найдено');
        expect(content.textContent?.length ?? 0).toBeGreaterThan(6);
      }
      expect(hudCss).toMatch(/\.slot,\s*\.taxButton\s*\{[^}]*min-width: 0;/);
      expect(hudCss).toMatch(/\.taxButton\s*\{[\s\S]*?min-width: var\(--touch-target-min\);/);
      cleanup();
    }
  });
});
