import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => cleanup());

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

    for (const viewportWidth of [1280, 1366, 1440, 1920]) {
      render(
        <Hud
          view={longView}
          send={() => undefined}
          fog={false}
          setFog={() => undefined}
          style={{ width: `${viewportWidth}px`, left: 0, top: 0 }}
        />,
      );
      const hud = document.querySelector<HTMLElement>('header');
      if (!hud) throw new Error('Hud не найден');
      const directChildren = Array.from(hud.children) as HTMLElement[];
      const slots = directChildren.filter((element) => element.className.includes('slot'));
      const taxWrap = directChildren.find((element) => element.className.includes('taxWrap'));
      const taxButton = taxWrap?.querySelector<HTMLElement>('[class*="taxButton"]');
      if (!taxWrap || !taxButton) throw new Error('Налоговая кнопка не найдена');
      expect(slots).toHaveLength(5);

      const itemWidth = (viewportWidth - 32 - 44) / 6;
      const declaredSlotMinWidth = Math.max(
        0,
        ...[...hudCss.matchAll(/(?:^|\n)\.slot(?:,\s*\.taxButton)?\s*\{([^}]*)\}/g)].map((match) =>
          Number(match[1]?.match(/min-width:\s*(\d+)px/)?.[1] ?? 0),
        ),
      );
      const itemRects = [...slots, taxWrap].map((element, index) => {
        const width = element === taxWrap ? itemWidth : Math.max(itemWidth, declaredSlotMinWidth);
        const left = 16 + index * itemWidth;
        return { left, right: left + width };
      });
      const rects = new Map<Element, DOMRect>();
      rects.set(hud, new DOMRect(0, 0, viewportWidth, 48));
      for (const [index, element] of [...slots, taxWrap].entries()) {
        const item = itemRects[index];
        if (!item) throw new Error('Геометрия слота не рассчитана');
        const rect = new DOMRect(item.left, 0, item.right - item.left, 48);
        rects.set(element, rect);
        for (const child of Array.from(element.querySelectorAll('*'))) {
          const childRect = child.className.toString().includes('slotText')
            ? new DOMRect(rect.left + 18, 0, Math.max(0, rect.width - 18), 48)
            : rect;
          rects.set(child, childRect);
        }
      }
      const taxRect = rects.get(taxWrap);
      if (!taxRect) throw new Error('Геометрия налоговой кнопки не рассчитана');
      rects.set(taxButton, taxRect);
      for (const child of Array.from(taxButton.querySelectorAll('*'))) {
        const childRect = child.className.toString().includes('slotText')
          ? new DOMRect(taxRect.left + 18, 0, Math.max(0, taxRect.width - 18), 48)
          : taxRect;
        rects.set(child, childRect);
      }
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
      ) {
        return rects.get(this) ?? new DOMRect();
      });

      const measuredHud = hud.getBoundingClientRect();
      expect(measuredHud.right).toBe(viewportWidth);
      for (const element of slots) {
        const rect = element.getBoundingClientRect();
        const content = element.querySelector<HTMLElement>('[class*="slotText"]');
        if (!content) throw new Error('Содержимое слота не найдено');
        expect(rect.width).toBeLessThanOrEqual(itemWidth + 0.01);
        expect(content.getBoundingClientRect().width).toBeLessThanOrEqual(rect.width - 18 + 0.01);
        expect(rect.left).toBeGreaterThanOrEqual(measuredHud.left);
        expect(rect.right).toBeLessThanOrEqual(measuredHud.right);
      }
      const taxRectMeasured = taxButton.getBoundingClientRect();
      const taxContent = taxButton.querySelector<HTMLElement>('[class*="slotText"]');
      if (!taxContent) throw new Error('Содержимое налога не найдено');
      expect(taxRectMeasured.width).toBeLessThanOrEqual(itemWidth + 0.01);
      expect(taxContent.getBoundingClientRect().width).toBeLessThanOrEqual(
        taxRectMeasured.width - 18 + 0.01,
      );
      expect(taxRectMeasured.left).toBeGreaterThanOrEqual(measuredHud.left);
      expect(taxRectMeasured.right).toBeLessThanOrEqual(measuredHud.right);
      expect(hudCss).toMatch(/\.slot,\s*\.taxButton\s*\{[^}]*min-width: 0;/);
      expect(hudCss).toMatch(/\.taxButton\s*\{[\s\S]*?min-width: var\(--touch-target-min\);/);

      for (const element of [...slots, taxWrap, taxButton]) {
        const parent = element.parentElement?.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        if (!parent) throw new Error('Родитель HUD не найден');
        expect(rect.left).toBeGreaterThanOrEqual(parent.left - 0.01);
        expect(rect.right).toBeLessThanOrEqual(parent.right + 0.01);
        for (const child of Array.from(element.querySelectorAll('*'))) {
          const childRect = child.getBoundingClientRect();
          expect(childRect.left).toBeGreaterThanOrEqual(rect.left - 0.01);
          expect(childRect.right).toBeLessThanOrEqual(rect.right + 0.01);
        }
      }
      cleanup();
    }
  });
});
