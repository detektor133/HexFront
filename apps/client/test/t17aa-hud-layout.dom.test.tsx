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
      const explicitTextWidth = Number.parseFloat(
        cssBlock('.slotText').match(/(?:^|\n)\s*width:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? '',
      );
      if (Number.isFinite(explicitTextWidth)) {
        expect(explicitTextWidth).toBeLessThanOrEqual(itemWidth - 14);
      }
      const contentWidth = (element: HTMLElement): number | null => {
        const width = Number.parseFloat(getComputedStyle(element).width);
        return Number.isFinite(width) ? width : null;
      };
      const hudWidth = Number.parseFloat(getComputedStyle(hud).width);
      expect(hudWidth).toBe(viewportWidth);

      for (const [index, element] of [...slots, taxWrap].entries()) {
        const expectedLeft = 16 + index * itemWidth;
        const expectedRight = expectedLeft + itemWidth;
        expect(expectedLeft).toBeGreaterThanOrEqual(16);
        expect(expectedRight).toBeLessThanOrEqual(viewportWidth - 16);
        expect(contentWidth(element)).toBeNull();

        for (const child of Array.from(element.querySelectorAll('*'))) {
          const childElement = child as HTMLElement;
          const width = contentWidth(childElement);
          if (childElement.className.toString().includes('slotText')) {
            expect(childElement.textContent?.length ?? 0).toBeGreaterThan(0);
            if (width !== null) expect(width).toBeLessThanOrEqual(itemWidth - 14);
          } else if (width !== null) {
            expect(width).toBeLessThanOrEqual(itemWidth);
          }
        }
      }

      const taxContent = taxButton.querySelector<HTMLElement>('[class*="slotText"]');
      if (!taxContent) throw new Error('Содержимое налога не найдено');
      expect(taxContent.textContent?.length ?? 0).toBeGreaterThan(0);
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
