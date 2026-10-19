import { readFileSync } from 'node:fs';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap } from '@hexfront/sim';

import { expectNoGeometryTransition, installPanelStyles } from './panel-css.ts';
import {
  panel,
  panelStyle,
  expectedPanelStyle,
  expectDockPadding,
  expectElementStyle,
} from './t17q-layout.ts';
import { installMatchMocks } from './t17q-match.ts';
import { installResizeObserver, reportHeight, type ResizeStats } from './t17q-resize.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import type { LocalEngine } from '../src/local/engine.ts';
import { computeMatchLayout } from '../src/match/layout.ts';

const mapJson: unknown = JSON.parse(readFileSync('packages/mapgen/maps/tiny.json', 'utf8'));
const fivePlayerMapJson: unknown = JSON.parse(
  readFileSync('packages/mapgen/maps/small.json', 'utf8'),
);
const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));
const loadedMap = mapResult.map;

function requireLocalEngine(engine: ReturnType<typeof createLocalEngine>): LocalEngine {
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  return engine;
}

let removeStyles: () => void;
beforeEach(() => {
  removeStyles = installPanelStyles();
});
afterEach(() => {
  removeStyles();
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/match');
});

describe('07/T17q: нижняя привязка ArmyBar', () => {
  it.each([
    [360, 640],
    [1440, 900],
    [1920, 1080],
  ])(
    'монтирует реальный MatchPage %dx%d, сохраняет координаты и измеряет ArmyBar один раз',
    async (width, height) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      const stats: ResizeStats = {
        dockObserves: 0,
        dockDisconnects: 0,
        dockCallbacks: 0,
        cardObserves: 0,
        cardDisconnects: 0,
        observers: [],
      };
      installResizeObserver(stats);
      const engine = requireLocalEngine(createLocalEngine(mapJson, 42, 2));
      const firstHex = engine.state.cities.find((city) => city.owner === 0)?.hex;
      const secondHex = engine.state.cities.find((city) => city.owner === 1)?.hex;
      if (firstHex === undefined || secondHex === undefined)
        throw new Error('города для выбора не найдены');
      const { getTap, emit } = installMatchMocks(engine, mapJson);
      const { MatchPage } = await import('../src/match/MatchPage.tsx');

      const { unmount } = render(<MatchPage />);
      await waitFor(() => expect(getTap()).toBeDefined());
      await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(width, height)));
      const before = panelStyle();
      expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
      expect(stats.dockObserves).toBe(1);
      expect(stats.observers.filter((item) => item.kind === 'dock')).toHaveLength(1);
      expect(
        stats.observers.find((item) => item.kind === 'dock')?.target.className.toString(),
      ).toContain('content');
      const armyBar = panel();
      const armyBarStyle = panelStyle();
      expectNoGeometryTransition(armyBar);
      expectDockPadding();
      for (const leaderboardRows of [2, 5]) {
        for (const cardHeight of [88, 160]) {
          expect(expectedPanelStyle(width, height, 150, cardHeight, leaderboardRows)).toEqual(
            before,
          );
        }
      }
      expect(document.querySelector('[class*="strip"]')).not.toBeNull();
      const strip = document.querySelector<HTMLElement>('[class*="strip"]');
      if (!strip) throw new Error('лента армий не найдена');
      const stripStyle = getComputedStyle(strip).overflowX;
      if (stripStyle !== 'visible') expect(stripStyle).toBe('auto');
      else
        expect(readFileSync('apps/client/src/dev/ArmyBar.module.css', 'utf8')).toMatch(
          /overflow-x: auto;/u,
        );
      expect(screen.getAllByRole('button', { name: '1-я армия' }).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Резерв' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Автопополнение' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Новая армия' })).toBeTruthy();
      const leaderboard =
        width > 600 ? document.querySelector<HTMLElement>('section[aria-label]') : null;
      if (width > 600 && !leaderboard) throw new Error('лидерборд не найден');
      const leaderboardStyle = leaderboard?.getAttribute('style');
      if (leaderboard) {
        expectNoGeometryTransition(leaderboard);
      }

      const tap = getTap();
      if (!tap) throw new Error('обработчик карты не установлен');
      const select = async (hex: number): Promise<void> => {
        const point = hexFromId(hex, loadedMap.width);
        act(() => tap(point, 'select', { x: 100, y: 100 }));
        act(() => tap(point, 'select', { x: 100, y: 100 }));
        expect(engine.snapshot().selection?.hex).toBe(hex);
        await waitFor(() =>
          expect(document.querySelector('section[class*="card"]')).not.toBeNull(),
        );
      };
      await select(firstHex);
      expect(panelStyle()).toEqual(armyBarStyle);
      const renderedCard = document.querySelector<HTMLElement>('section[class*="card"]');
      if (!renderedCard) throw new Error('карточка клетки не найдена');
      expectNoGeometryTransition(renderedCard);
      const cardStyle = renderedCard.getAttribute('style');
      expect(renderedCard.style.height).toBe('114px');
      const cardSubscriptions = stats.cardObserves;
      for (let notification = 0; notification < 3; notification += 1) {
        act(() => reportHeight(stats, 'card'));
        expect(renderedCard.getAttribute('style')).toBe(cardStyle);
        expect(panelStyle()).toEqual(armyBarStyle);
      }
      expect(stats.cardObserves).toBe(cardSubscriptions);
      expectElementStyle('card', {
        viewport: { width, height },
        hudHeight: 88,
        bottomPanelHeight: Number.parseFloat(panel().style.height),
        eventRows: 0,
        tutorialVisible: true,
        leaderboardOpen: width > 600,
        leaderboardRows: 2,
        cardHeight: Number.parseFloat(renderedCard.style.height),
        cardOpen: true,
        popupOpen: false,
        paused: false,
      });
      if (width > 600) {
        expect(
          document.querySelector<HTMLElement>('section[aria-label]')?.getAttribute('style'),
        ).toBe(leaderboardStyle);
      }
      expect(stats.observers.some((item) => item.kind === 'card')).toBe(true);
      expect(stats.dockObserves).toBe(1);
      const firstArmy = engine.state.armies.find((army) => army.owner === 0);
      if (!firstArmy) throw new Error('Армия владельца не найдена');
      firstArmy.name = 'Обновлённая армия';
      act(emit);
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: 'Обновлённая армия' }).length).toBeGreaterThan(
          0,
        ),
      );
      expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
      expect(panel()).toBe(armyBar);
      expect(panelStyle()).toEqual(armyBarStyle);
      act(() => reportHeight(stats, 'dock'));
      act(() => reportHeight(stats, 'card'));
      expect(panelStyle()).toEqual(armyBarStyle);
      expect(renderedCard.getAttribute('style')).toBe(cardStyle);
      expect(stats.cardObserves).toBe(cardSubscriptions);
      expectDockPadding();
      expect(stats.dockObserves).toBe(1);
      for (const cardHeight of [88, 160]) {
        act(() => reportHeight(stats, 'card', cardHeight - 26));
        await waitFor(() =>
          expect(panelStyle()).toEqual(expectedPanelStyle(width, height, 150, cardHeight)),
        );
        const resizedCard = document.querySelector<HTMLElement>('section[class*="card"]');
        expect(resizedCard?.style.height).toBe(`${cardHeight}px`);
        const resizedStyle = resizedCard?.getAttribute('style');
        for (let notification = 0; notification < 3; notification += 1) {
          act(() => reportHeight(stats, 'card'));
          expect(resizedCard?.getAttribute('style')).toBe(resizedStyle);
        }
      }
      firstArmy.name = '1-я армия';
      act(emit);
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: '1-я армия' }).length).toBeGreaterThan(0),
      );
      const armyButton = screen.getAllByRole('button', { name: '1-я армия' })[0];
      if (!armyButton) throw new Error('карточка первой армии не найдена');
      fireEvent.click(armyButton);
      expect(panelStyle()).toEqual(before);
      await select(secondHex);
      expect(panelStyle()).toEqual(before);
      if (width > 600) {
        expect(
          document.querySelector<HTMLElement>('section[aria-label]')?.getAttribute('style'),
        ).toBe(leaderboardStyle);
      }
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(document.querySelector('section[class*="card"]')).toBeNull());
      expect(panelStyle()).toEqual(before);
      expect(document.querySelectorAll('[class*="dock"]')).toHaveLength(1);
      expect(stats.dockObserves).toBe(1);

      act(() => reportHeight(stats, 'dock', 200));
      await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(width, height, 200)));
      const afterResize = panelStyle();
      act(() => reportHeight(stats, 'dock', 220));
      await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(width, height, 220)));
      const afterSecondResize = panelStyle();
      const callbacksBeforeRepeat = stats.dockCallbacks;
      act(() => reportHeight(stats, 'dock', 220));
      await waitFor(() => expect(panelStyle()).toEqual(afterSecondResize));
      expect(afterResize).not.toEqual(afterSecondResize);
      expect(stats.dockCallbacks).toBe(callbacksBeforeRepeat + 1);
      for (const intrinsicHeight of [160, 160, 160]) {
        act(() => reportHeight(stats, 'dock', intrinsicHeight));
        expect(panelStyle()).toEqual(expectedPanelStyle(width, height, intrinsicHeight));
        expect(Number.parseFloat(panel().style.top) + Number.parseFloat(panel().style.height)).toBe(
          height,
        );
      }
      expect(stats.dockObserves).toBe(1);
      unmount();
      expect(stats.dockDisconnects).toBe(1);
      expect(stats.cardDisconnects).toBe(stats.cardObserves);
    },
  );

  it('сохраняет привязку при пяти строках реального лидерборда', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const stats: ResizeStats = {
      dockObserves: 0,
      dockDisconnects: 0,
      dockCallbacks: 0,
      cardObserves: 0,
      cardDisconnects: 0,
      observers: [],
    };
    installResizeObserver(stats);
    const engine = requireLocalEngine(createLocalEngine(fivePlayerMapJson, 42, 5));
    const { getTap } = installMatchMocks(engine, fivePlayerMapJson);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    const { unmount } = render(<MatchPage />);
    await waitFor(() => expect(getTap()).toBeDefined());
    await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(1440, 900, 150, 0, 5)));
    expect(screen.getByText('Живы: 5')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getAllByRole('rowheader')).toHaveLength(5);
    for (const row of screen.getAllByRole('row')) {
      expect(row.querySelector('[role="rowheader"]')?.textContent).toMatch(/^\d+$/u);
      const cells = row.querySelectorAll('[role="cell"]');
      expect(cells).toHaveLength(2);
      expect(cells[0]?.textContent).not.toBe('');
      expect(cells[1]?.textContent).toMatch(/^-?\d+$/u);
    }
    expect(stats.dockObserves).toBe(1);
    for (let notification = 0; notification < 3; notification += 1) {
      act(() => reportHeight(stats, 'dock'));
      await waitFor(() => expect(panelStyle()).toEqual(expectedPanelStyle(1440, 900, 150, 0, 5)));
    }
    unmount();
    expect(stats.dockDisconnects).toBe(1);
  });

  it('убирает ArmyBar на время открытого налога и возвращает её с теми же координатами', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    const stats: ResizeStats = {
      dockObserves: 0,
      dockDisconnects: 0,
      dockCallbacks: 0,
      cardObserves: 0,
      cardDisconnects: 0,
      observers: [],
    };
    installResizeObserver(stats);
    const engine = requireLocalEngine(createLocalEngine(mapJson, 42, 2));
    const { getTap } = installMatchMocks(engine, mapJson);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    const { unmount } = render(<MatchPage />);
    await waitFor(() => expect(getTap()).toBeDefined());
    await waitFor(() => expect(panel()).toBeTruthy());
    expect(stats.observers.filter((item) => item.kind === 'dock')).toHaveLength(1);
    const before = panelStyle();
    expect(
      computeMatchLayout({
        viewport: { width: 1440, height: 900 },
        hudHeight: 88,
        bottomPanelHeight: 150,
        eventRows: 0,
        tutorialVisible: true,
        leaderboardOpen: true,
        leaderboardRows: 2,
        cardHeight: 88,
        cardOpen: true,
        popupOpen: true,
        paused: false,
      }).elements.some((item) => item.id === 'bottom-panel'),
    ).toBe(false);
    for (const cardHeight of [88, 160]) {
      for (const leaderboardRows of [2, 5]) {
        expect(expectedPanelStyle(1440, 900, 150, cardHeight, leaderboardRows)).toEqual(before);
      }
    }
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    await waitFor(() => expect(document.querySelector('[class*="dock"]')).toBeNull());
    expect(screen.getByRole('slider', { name: 'Налог' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    await waitFor(() => expect(panelStyle()).toEqual(before));
    expect(stats.dockObserves).toBe(2);
    expect(stats.dockDisconnects).toBeGreaterThanOrEqual(1);
    expect(stats.observers.filter((item) => item.kind === 'dock')).toHaveLength(2);
    unmount();
    expect(stats.dockDisconnects).toBe(2);
  });

  it.each([
    [1440, 900],
    [1920, 1080],
  ])(
    'сохраняет границы карточки при двух высотах и двух размерах лидерборда (%dx%d)',
    (width, height) => {
      for (const leaderboardRows of [2, 5]) {
        for (const cardHeight of [88, 160]) {
          const layout = computeMatchLayout({
            viewport: { width, height },
            hudHeight: 88,
            bottomPanelHeight: 150,
            eventRows: 0,
            tutorialVisible: true,
            leaderboardOpen: true,
            leaderboardRows,
            cardHeight,
            cardOpen: true,
            popupOpen: false,
            paused: false,
          });
          const dock = layout.elements.find((item) => item.id === 'bottom-panel');
          const card = layout.elements.find((item) => item.id === 'card');
          expect(dock).toBeDefined();
          expect(card).toBeDefined();
          if (!dock || !card) continue;
          expect(card.y + card.height).toBeLessThanOrEqual(dock.y - 8);
          expect(card.y + card.height).toBeLessThanOrEqual(height);
          expect(dock.y + dock.height).toBeLessThanOrEqual(height);
        }
      }
    },
  );

  it('не ограничивает обычный ПК правилом телефонного альбома', () => {
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      const layout = computeMatchLayout({
        viewport,
        hudHeight: 88,
        bottomPanelHeight: 1000,
        eventRows: 0,
        tutorialVisible: false,
        leaderboardOpen: false,
        leaderboardRows: 0,
        cardHeight: 0,
        cardOpen: false,
        popupOpen: false,
        paused: false,
      });
      expect(layout.bottomPanelHeight).toBe(viewport.height - 88 - 8);
    }
  });
});
