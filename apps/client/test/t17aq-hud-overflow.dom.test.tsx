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
    /\.(hud|slot|taxWrap|taxButton|slotText|rate|value|settingsButton)\b/gu,
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
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          (element.className.toString().includes('slot') ||
            element.className.toString().includes('taxWrap')),
      );
      expect(groups).toHaveLength(6);
      const hudRect = hud.getBoundingClientRect();
      let previousRight = hudRect.left;
      for (const group of groups) {
        const icon = group.querySelector<SVGElement>('svg');
        const value = group.querySelector<HTMLElement>('[class*="slotText"]');
        const growth = group.querySelector<HTMLElement>('[class*="rate"]');
        expect(icon?.getAttribute('aria-label')).toBeTruthy();
        expect(value?.textContent).not.toBe('');
        if (group.className.toString().includes('slot')) {
          expect(growth?.textContent).not.toBe('');
        }
        const rect = group.getBoundingClientRect();
        expect(rect.width).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(hudRect.right);
        expect(rect.left).toBeGreaterThanOrEqual(previousRight);
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

  it('на 360 px оставляет одну строку без горизонтального скролла и сохраняет приросты', () => {
    const hud = renderHud(360);
    expect(getComputedStyle(hud).flexWrap).toBe('nowrap');
    expect(hud.scrollWidth).toBeLessThanOrEqual(hud.clientWidth || 360);
    expect(
      Array.from(hud.children).filter((element) => element.className.toString().includes('slot')),
    ).toHaveLength(5);
    expect(hud.querySelectorAll('[class*="rate"]').length).toBeGreaterThanOrEqual(2);
    expect(hud.textContent).toContain('%');
    expect(hud.textContent).toMatch(/#\d+/u);
  });
});
