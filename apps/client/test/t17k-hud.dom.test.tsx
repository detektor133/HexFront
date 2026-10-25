import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap, TICKS_PER_S } from '@hexfront/sim';

import { Hud } from '../src/dev/Hud.tsx';
import { formatClock, formatFp, formatPercent, formatRate } from '../src/i18n/format.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const hudCss = readFileSync(join(process.cwd(), 'apps/client/src/dev/Hud.module.css'), 'utf8');
const tokensJson = readFileSync(join(process.cwd(), 'docs/art/tokens.json'), 'utf8');

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const parsedMap = loadMap(mapJson);
if (!parsedMap.ok) throw new Error(parsedMap.errors.join('; '));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHud(): { readonly onPause: ReturnType<typeof vi.fn> } {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const onPause = vi.fn();
  render(
    <Hud
      view={engine.snapshot().view}
      send={vi.fn()}
      fog={true}
      setFog={vi.fn()}
      showFog={false}
      onPause={onPause}
    />,
  );
  return { onPause };
}

function layoutInput(viewport: { readonly width: number; readonly height: number }) {
  return {
    viewport,
    hudHeight: viewport.width <= 600 ? 44 : 48,
    bottomPanelHeight: 120,
    eventRows: 0,
    tutorialVisible: false,
    leaderboardOpen: false,
    leaderboardRows: 0,
    cardHeight: 0,
    cardOpen: false,
    popupOpen: false,
    paused: false,
  } as const;
}

describe('07/T17k: компактный HUD', () => {
  it('сохраняет шесть метрик, доступные кнопки и правильные SVG', () => {
    renderHud();
    for (const label of ['Люди', 'Золото', 'Налог', 'Снабжение', 'Время', 'Место']) {
      expect(document.querySelector(`svg[aria-label="${label}"]`)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Налог' }).getAttribute('title')).toBe('Налог');
    expect(screen.getByRole('button', { name: 'Настройки' }).getAttribute('title')).toBe(
      'Настройки',
    );
    expect(screen.getByRole('button', { name: 'Пауза' }).getAttribute('title')).toBe('Пауза');
    expect(
      screen
        .getByRole('button', { name: 'Настройки' })
        .querySelector('svg[aria-hidden="true"]')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
    for (const icon of Array.from(document.querySelectorAll('header svg[aria-label]'))) {
      expect(icon.getAttribute('viewBox')).toBe('0 0 14 14');
    }
    const gold = document.querySelector('svg[aria-label="Золото"]');
    expect(gold?.getAttribute('class')).toContain('goldIcon');
    expect(gold?.querySelectorAll('path').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Пауза' }).querySelectorAll('path')).toHaveLength(2);

    for (const icon of Array.from(document.querySelectorAll('header svg[aria-label]'))) {
      for (const path of Array.from(icon.querySelectorAll('path'))) {
        const coordinates =
          path
            .getAttribute('d')
            ?.match(/-?\d+(?:\.\d+)?/g)
            ?.map(Number) ?? [];
        expect(coordinates.every((coordinate) => coordinate >= 0 && coordinate <= 14)).toBe(true);
      }
    }
    expect(document.querySelector('svg[aria-label="Налог"] path')?.getAttribute('d')).toBe(
      'M4 10L10 4',
    );
    expect(tokensJson).toContain('"color": "#C99A2E"');
    expect(hudCss).toContain('.goldIcon {\n  color: var(--selection-color);\n}');
    expect(hudCss).toContain('height: 44px;');
    expect(hudCss).toContain('min-height: var(--touch-target-min);');
    expect(hudCss).toContain('min-width: var(--touch-target-min);');
    expect(hudCss).not.toContain('overflow-x: hidden;');
  });

  it('сохраняет компактную ширину, центрирование и один ряд на четырёх viewport', () => {
    for (const viewport of [
      { width: 360, height: 640 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      const layout = computeMatchLayout(layoutInput(viewport));
      const hud = layout.elements.find((element) => element.id === 'hud');
      expect(hud).toBeDefined();
      if (!hud) continue;
      if (viewport.width <= 600) {
        expect(hud.width).toBe(viewport.width);
        expect(hud.x).toBe(0);
      } else {
        expect(hud.width).toBeLessThan(viewport.width);
        expect(hud.x).toBe((viewport.width - hud.width) / 2);
      }
      expect(validateMatchLayout(layout)).toEqual([]);
    }
  });

  it('показывает значения шести метрик и оба прироста', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const view = engine.snapshot().view;
    const me = view.players[view.playerId];
    if (!me) throw new Error('Игрок не найден');
    render(<Hud view={view} send={vi.fn()} fog={true} setFog={vi.fn()} showFog={false} />);
    const hudText = document.querySelector('header')?.textContent ?? '';
    expect(hudText).toContain(formatFp(view.me.popTotal));
    expect(hudText).toContain(formatFp(me.gold));
    expect(hudText).toContain(formatPercent(me.taxTarget));
    expect(hudText).toContain(formatPercent(view.me.supplyLevel));
    expect(hudText).toContain(formatClock(view.tick, TICKS_PER_S));
    expect(screen.getByText(`#${view.me.place}/${view.me.players}`)).toBeTruthy();
    expect(hudText).toContain(formatRate(view.me.popGrowthPerS));
    expect(hudText).toContain(formatRate(view.me.incomePerS - view.me.upkeepPerS));
  });

  it('открывает каждое меню под своей кнопкой', () => {
    renderHud();
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    expect(
      screen
        .getByRole('dialog', { name: 'Налог' })
        .parentElement?.contains(screen.getByRole('button', { name: 'Налог' })),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    expect(
      screen
        .getByRole('dialog', { name: 'Настройки' })
        .parentElement?.contains(screen.getByRole('button', { name: 'Настройки' })),
    ).toBe(true);
  });

  it('вызывает обработчик паузы по клику на кнопку 44×44', () => {
    const { onPause } = renderHud();
    const pause = screen.getByRole('button', { name: 'Пауза' });
    fireEvent.click(pause);
    expect(onPause).toHaveBeenCalledOnce();
    expect(hudCss).toMatch(/\.settingsButton[\s\S]*?height: 44px;/);
  });

  it('на 360 px сокращает место до #N без удаления прироста и остальных цифр', () => {
    const innerWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360);
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const view = engine.snapshot().view;
    const me = view.players[view.playerId];
    if (!me) throw new Error('Игрок не найден');
    render(<Hud view={view} send={vi.fn()} fog={true} setFog={vi.fn()} showFog={false} />);
    expect(screen.getByText(`#${view.me.place}`)).toBeTruthy();
    expect(screen.queryByText(`#${view.me.place}/${view.me.players}`)).toBeNull();
    const hudText = document.querySelector('header')?.textContent ?? '';
    expect(hudText).toContain(formatFp(view.me.popTotal));
    expect(hudText).toContain(formatFp(me.gold));
    expect(hudText).toContain(formatPercent(me.taxTarget));
    expect(hudText).toContain(formatPercent(view.me.supplyLevel));
    expect(hudText).toContain(formatClock(view.tick, TICKS_PER_S));
    expect(hudText).toContain(formatRate(view.me.popGrowthPerS));
    expect(hudText).toContain(formatRate(view.me.incomePerS - view.me.upkeepPerS));
    innerWidth.mockRestore();
  });

  it('на 360 px сохраняет 44×44 у трёх кнопок и экономит отступы под строку', () => {
    renderHud();
    expect(screen.getByRole('button', { name: 'Налог' }).className).toContain('taxButton');
    expect(screen.getByRole('button', { name: 'Настройки' }).className).toContain('settingsButton');
    expect(screen.getByRole('button', { name: 'Пауза' }).className).toContain('settingsButton');
    expect(hudCss).toMatch(
      /\.hud \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(6, minmax\(0, 1fr\)\) repeat\(2, var\(--touch-target-min\)\);[\s\S]*?\}/,
    );
    const hudRule = hudCss.match(/\.hud \{[^}]*\}/)?.[0] ?? '';
    expect(hudRule).not.toContain('flex:');
    const desktopHudCss = hudCss.split('@media')[0] ?? hudCss;
    const directChildLayoutRules =
      desktopHudCss.match(
        /\.hud > \.(?:slot|taxWrap|settingsButton)(?:,\s*\.hud > \.(?:slot|taxWrap|settingsButton))*\s*\{[^}]*\}/g,
      ) ?? [];
    expect(directChildLayoutRules).toHaveLength(2);
    expect(directChildLayoutRules.join('\n')).toContain('.hud > .slot');
    expect(directChildLayoutRules.join('\n')).toContain('.hud > .taxWrap');
    expect(directChildLayoutRules.join('\n')).toContain('.hud > .settingsButton');
    expect(hudCss).toMatch(
      /\.settingsButton \{[\s\S]*?width: var\(--touch-target-min\);[\s\S]*?height: 44px;[\s\S]*?\}/,
    );
    expect(hudCss).toMatch(
      /\.taxButton \{[\s\S]*?box-sizing: border-box;[\s\S]*?flex: 1 1 auto;[\s\S]*?width: auto;[\s\S]*?height: auto;[\s\S]*?min-height: var\(--touch-target-min\);[\s\S]*?min-width: var\(--touch-target-min\);[\s\S]*?\}/,
    );
    expect(hudCss).toMatch(
      /@media \(max-width: 360px\) \{\s*\.hud \{\s*padding: 0 var\(--space-sm\);\s*\}/,
    );
    expect(hudCss).toMatch(/\.taxWrap \.taxButton \{[\s\S]*?inline-size: 100%;[\s\S]*?\}/);
    expect(hudCss).not.toContain('overflow-x: hidden;');
  });
});
