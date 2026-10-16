// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';

const MAP_JSON: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const LOADED_MAP = loadMap(MAP_JSON);
if (!LOADED_MAP.ok) throw new Error(LOADED_MAP.errors.join('; '));
const LOADED_MAP_DATA = LOADED_MAP.map;

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

function createRuntime(): Record<string, unknown> {
  const engine = createLocalEngine(MAP_JSON, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const snapshot = engine.snapshot();

  return {
    msg: snapshot,
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

async function renderMatch(viewport: (typeof VIEWPORTS)[number]): Promise<void> {
  window.history.replaceState({}, '', '/match');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height });
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: MAP_JSON, map: LOADED_MAP_DATA }),
    useSandbox: () => createRuntime(),
  }));
  const { MatchPage } = await import('../src/match/MatchPage.tsx');
  render(<MatchPage />);
}

function readPixels(value: string): number {
  const pixels = Number.parseFloat(value);
  if (!Number.isFinite(pixels)) throw new Error(`Ожидалось значение в px, получено: ${value}`);
  return pixels;
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('Приёмка 07/T17e: окно налога', () => {
  it('критерий 1: клик по «Налог» открывает окно изменения налога', async () => {
    await renderMatch(VIEWPORTS[0]);

    expect(screen.queryByRole('dialog', { name: /Налог|Tax/u })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Налог|Tax/u }));

    expect(screen.getByRole('dialog', { name: /Налог|Tax/u })).toBeTruthy();
  });

  it('критерий 2: окно налога привязано прямо под кнопкой, содержит только нужный контент и не имеет пустой фиксированной высоты', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      if (this.tagName === 'BUTTON' && this.textContent?.includes('Налог')) {
        return new DOMRect(320, 0, 120, 48);
      }
      return originalRect.call(this);
    };
    await renderMatch(VIEWPORTS[1]);
    const button = screen.getByRole('button', { name: /Налог|Tax/u });
    const hud = button.closest('header');
    if (!hud) throw new Error('Кнопка «Налог» не находится в верхней панели');
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: /Налог|Tax/u });

    expect(dialog.children).toHaveLength(3);
    expect(dialog.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(dialog.querySelectorAll('p')).toHaveLength(2);
    expect(dialog.querySelectorAll(':scope > *:not(input):not(p)')).toHaveLength(0);
    expect(dialog.style.height).not.toBe('100%');
    expect(dialog.style.minHeight).not.toBe('100%');
    expect(dialog.style.width).not.toBe('100%');
    expect(dialog.style.minWidth).not.toBe('100%');
    expect(readPixels(dialog.style.top)).toBe(
      readPixels(hud.style.top) + readPixels(hud.style.height),
    );
    expect(readPixels(dialog.style.left)).toBe(320);
    expect(readPixels(dialog.style.width)).toBeLessThanOrEqual(260);
    expect(readPixels(dialog.style.height)).toBeLessThanOrEqual(120);
  });

  it('критерий 3: окно налога не выходит за экран на 360×640, 1440×900 и 1920×1080', async () => {
    for (const viewport of VIEWPORTS) {
      await renderMatch(viewport);
      fireEvent.click(screen.getByRole('button', { name: /Налог|Tax/u }));
      const dialog = screen.getByRole('dialog', { name: /Налог|Tax/u });
      const left = readPixels(dialog.style.left);
      const top = readPixels(dialog.style.top);
      const right = left + readPixels(dialog.style.width);
      const bottom = top + readPixels(dialog.style.height);

      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(viewport.width);
      expect(bottom).toBeLessThanOrEqual(viewport.height);
      expect(document.querySelector('[class*="dock"]')).toBeNull();
      cleanup();
      vi.resetModules();
    }
  });
});
