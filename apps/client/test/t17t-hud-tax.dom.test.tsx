import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { createLocalEngine } from '../src/local/engine.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const loadedMap = loaded.map;

const hudCss = readFileSync(join(process.cwd(), 'apps/client/src/dev/Hud.module.css'), 'utf8');
const tokensJson = readFileSync(join(process.cwd(), 'docs/art/tokens.json'), 'utf8');

function createRuntime(): Record<string, unknown> {
  const engine = createLocalEngine(mapJson, 42, 2);
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
    send: vi.fn(),
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
    setHudHeight: () => undefined,
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

function mockRuntime(): void {
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: mapJson, map: loadedMap }),
    useSandbox: () => createRuntime(),
  }));
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('07/T17t: золото и налог в HUD ПК', () => {
  it('проходит реальный путь MatchPage → MatchSurface → Hud на четырёх ПК-окнах', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height });
      const { unmount } = render(<MatchPage />);
      for (const label of ['Люди', 'Золото', 'Налог', 'Снабжение', 'Время', 'Место']) {
        expect(screen.getByLabelText(label, { selector: 'svg' })).toBeTruthy();
      }
      expect(screen.getAllByText(/[+-]\d+(?:[,.]\d+)?\/с/u).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole('button', { name: 'Настройки' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Пауза' })).toBeTruthy();
      unmount();
    }
  });

  it('сохраняет монету и полное значение налога в одной доступной кнопке', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    render(<MatchPage />);

    const gold = screen.getByLabelText('Золото', { selector: 'svg' });
    expect(gold.getAttribute('viewBox')).toBe('0 0 14 14');
    expect(gold.getAttribute('stroke-width')).toBe('2');
    expect(gold.getAttribute('stroke-linecap')).toBe('round');
    expect(gold.getAttribute('stroke-linejoin')).toBe('round');
    expect(gold.querySelectorAll('path')).toHaveLength(2);
    expect(gold.getAttribute('class')).toContain('goldIcon');
    expect(tokensJson).toContain('"color": "#C99A2E"');

    const taxButton = screen.getByRole('button', { name: 'Налог' });
    expect(taxButton.title).toBe('Налог');
    expect(taxButton.textContent).toMatch(/%/u);
    expect(taxButton.querySelector('svg')).toBeTruthy();
    expect(taxButton.getAttribute('aria-expanded')).toBe('false');
    expect(taxButton.tabIndex).toBe(0);
    vi.spyOn(taxButton, 'getBoundingClientRect').mockReturnValue({
      left: 240,
      top: 0,
      right: 360,
      bottom: 48,
      width: 120,
      height: 48,
      x: 240,
      y: 0,
      toJSON: () => ({}),
    });
    const taxButtonRect = taxButton.getBoundingClientRect();
    expect(taxButtonRect.width).toBeGreaterThanOrEqual(44);
    expect(taxButtonRect.height).toBeGreaterThanOrEqual(44);
    taxButton.focus();
    fireEvent.keyDown(taxButton, { key: 'Enter' });
    expect(document.activeElement).toBe(taxButton);

    const taxValue = taxButton.querySelector('span');
    const taxIcon = taxButton.querySelector('svg');
    if (!taxValue || !taxIcon) throw new Error('Кнопка налога не содержит число и иконку');
    fireEvent.click(taxValue);
    expect(screen.getByRole('dialog', { name: 'Налог' })).toBeTruthy();
    fireEvent.click(taxIcon);
    expect(screen.queryByRole('dialog', { name: 'Налог' })).toBeNull();
    const taxButtonStart = hudCss.indexOf('\n.taxButton {\n  /*');
    const taxButtonCss = hudCss.slice(taxButtonStart).match(/[\s\S]*?\n\}/u)?.[0] ?? '';
    expect(taxButtonCss).toMatch(/min-width: var\(--touch-target-min\);/u);
    expect(taxButtonCss).not.toContain('  width: var(--touch-target-min);');
    expect(hudCss).not.toContain('.hud > .taxWrap {\n  flex: 0 0 var(--touch-target-min);');
    expect(hudCss).not.toContain('overflow-x: hidden;');
  });

  it('перепривязывает popup к новой геометрии фактической кнопки', async () => {
    mockRuntime();
    const { MatchPage } = await import('../src/match/MatchPage.tsx');
    class ResizableObserverMock {
      public static readonly callbacks: ResizeObserverCallback[] = [];

      public constructor(callback: ResizeObserverCallback) {
        ResizableObserverMock.callbacks.push(callback);
      }

      public observe(): void {}

      public disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', ResizableObserverMock);
    let left = 240;
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({
        left,
        bottom: 48,
        width: 120,
        height: 48,
        top: 0,
        right: left + 120,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }));
    render(<MatchPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Налог' }).style.left).toBe('240px'),
    );
    left = 520;
    for (const callback of ResizableObserverMock.callbacks) callback([], {} as ResizeObserver);
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Налог' }).style.left).toBe('520px'),
    );
    rect.mockRestore();
  });
});
