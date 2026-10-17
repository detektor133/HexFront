// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';
import type { ViewPayload } from '../src/local/messages.ts';

const MAP_JSON: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const LOADED_MAP = loadMap(MAP_JSON);
if (!LOADED_MAP.ok) throw new Error(LOADED_MAP.errors.join('; '));
const LOADED_MAP_VALUE = LOADED_MAP.map;

const VIEWPORTS = [360, 768, 1440] as const;
const LABELS = ['Люди', 'Золото', 'Налог', 'Снабжение', 'Время', 'Место'] as const;

function createRuntime(negativePopGrowth: boolean = false): Record<string, unknown> {
  const engine = createLocalEngine(MAP_JSON, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const snapshot = engine.snapshot();
  const msg: ViewPayload = negativePopGrowth
    ? {
        ...snapshot,
        view: {
          ...snapshot.view,
          me: { ...snapshot.view.me, popGrowthPerS: -1 },
        },
      }
    : snapshot;

  return {
    msg,
    replay: [],
    error: null,
    picked: { hex: null, units: [], target: null },
    lastReject: null,
    tool: null,
    army: null,
    fog: true,
    paused: false,
    speed: 1,
    observerId: null,
    events: [],
    workerTelemetry: null,
    snapshotTelemetry: () => ({ received: 0, collected: 0, live: 0 }),
    cacheTelemetry: () => ({
      unit: { shown: 0, drawnAt: 0, chips: 0, encircledSince: 0 },
      economy: { capturesByHex: 0, cityFlashes: 0 },
      frontTween: { byArmy: 0 },
    }),
    focusEvent: () => undefined,
    send: () => undefined,
    setFog: () => undefined,
    setPaused: () => undefined,
    step: () => undefined,
    setSpeed: () => undefined,
    setObserver: () => undefined,
    pick: () => undefined,
    setTool: () => undefined,
    setArmy: () => undefined,
    setRoadPreview: () => undefined,
    setDockHeight: () => undefined,
    pixiTelemetry: () => ({
      objects: 0,
      text: 0,
      graphics: 0,
      graphicsInstructions: [],
      graphicsDetails: [],
      textures: 0,
      canvasTextTextures: null,
    }),
  };
}

async function renderMatch(
  viewportWidth: number,
  negativePopGrowth: boolean = false,
): Promise<void> {
  window.history.replaceState({}, '', '/match');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 640 });
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: MAP_JSON, map: LOADED_MAP_VALUE }),
    useSandbox: () => createRuntime(negativePopGrowth),
  }));
  const { MatchPage } = await import('../src/match/MatchPage.tsx');
  render(<MatchPage />);
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('Приёмка 07/T17h: верхняя панель матча', () => {
  it('критерий 1: «нет видимых слов-подписей; у каждого значения есть иконка, число и (для людей и золота) прирост со знаком»', async () => {
    await renderMatch(1440);

    const header = document.querySelector('header');
    if (!header) throw new Error('Верхняя панель не найдена');
    for (const label of LABELS)
      expect(within(header).queryByText(label, { exact: true })).toBeNull();
    for (const value of ['280', '+2,8/с', '200', '+0,4/с', '20 %', '100 %', '00:00', '#1/2']) {
      expect(screen.getByText(value, { exact: true })).toBeTruthy();
    }

    const metrics = [
      { label: 'Люди', value: '280', rate: '+2,8/с' },
      { label: 'Золото', value: '200', rate: '+0,4/с' },
      { label: 'Налог', value: '20 %' },
      { label: 'Снабжение', value: '100 %' },
      { label: 'Время', value: '00:00' },
      { label: 'Место', value: '#1/2' },
    ] as const;
    const icons = Array.from(document.querySelectorAll<SVGElement>('svg[aria-label][title]'));
    expect(icons).toHaveLength(metrics.length);
    for (const metric of metrics) {
      const icon = within(header).getByLabelText(metric.label, { selector: 'svg' });
      expect(icon.getAttribute('title')).toBe(metric.label);
      const metricElement = icon.parentElement;
      if (!metricElement) throw new Error(`Иконка «${metric.label}» не связана со значением`);
      expect(metricElement).not.toBe(header);
      const metricText = metricElement.textContent?.replace(/\s+/g, '') ?? '';
      const expectedText = `${metric.value}${'rate' in metric ? metric.rate : ''}`.replace(
        /\s+/g,
        '',
      );
      expect(metricText).toBe(expectedText);
    }
  });

  it('критерий 2: «тест раскладки на 360, 768 и 1440 px (один ряд, без горизонтального скролла)»', async () => {
    for (const viewportWidth of VIEWPORTS) {
      await renderMatch(viewportWidth);
      const header = document.querySelector('header');
      if (!header) throw new Error('Верхняя панель не найдена');

      expect(getComputedStyle(header).flexWrap).toBe('nowrap');
      expect(getComputedStyle(header).overflowX).toBe('hidden');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(viewportWidth);
      expect(document.body.scrollWidth).toBeLessThanOrEqual(viewportWidth);
      if (viewportWidth === 360) {
        expect(screen.getByText('#1', { exact: true })).toBeTruthy();
        expect(screen.queryByText('#1/2', { exact: true })).toBeNull();
      } else {
        expect(screen.getByText('#1/2', { exact: true })).toBeTruthy();
      }
      cleanup();
      vi.resetModules();
    }
  });

  it('правило панели: «иконки — свои, по сетке 14×14, линия 2, round cap/join»', async () => {
    await renderMatch(1440);

    const icons = Array.from(document.querySelectorAll<SVGElement>('svg[aria-label][title]'));
    expect(icons).toHaveLength(6);
    for (const icon of icons) {
      expect(icon.getAttribute('viewBox')).toBe('0 0 14 14');
      expect(icon.getAttribute('stroke-width')).toBe('2');
      expect(icon.getAttribute('stroke-linecap')).toBe('round');
      expect(icon.getAttribute('stroke-linejoin')).toBe('round');
      const path = icon.querySelector('path');
      if (!path) throw new Error('У иконки нет пути');
      const coordinates = path.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? [];
      expect(
        coordinates.every((coordinate) => {
          return Number(coordinate) <= 14;
        }),
      ).toBe(true);
    }
  });

  it('критерий цвета прироста: отрицательный прирост людей получает status.danger', async () => {
    await renderMatch(1440, true);

    const peopleIcon = within(document.querySelector('header') as HTMLElement).getByLabelText(
      'Люди',
      {
        selector: 'svg',
      },
    );
    const peopleSlot = peopleIcon.parentElement;
    if (!peopleSlot) throw new Error('Слот людей не найден');
    const rate = within(peopleSlot).getByText('−0,0/с', { exact: true });
    expect(rate.className).toContain('rateBad');
  });
});
