import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MainMenu } from '../src/menu/MainMenu.tsx';

type WorkerMessage = Record<string, unknown>;

class FakeWorker {
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  public onerror: ((event: ErrorEvent) => void) | null = null;

  public postMessage(_message: WorkerMessage): void {}

  public addEventListener(): void {}

  public removeEventListener(): void {}

  public terminate(): void {}
}

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function renderMenu(): void {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })),
  );
  render(<MainMenu />);
}

function colorButtons(): HTMLButtonElement[] {
  return screen.getAllByRole('button', { name: /^Цвет /u }) as HTMLButtonElement[];
}

function expectVisible(element: HTMLElement): void {
  const style = getComputedStyle(element);
  expect(style.display).not.toBe('none');
  expect(style.visibility).not.toBe('hidden');
  expect(element.hidden).toBe(false);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('приёмка 07/T17a: главное меню после раунда замечаний владельца', () => {
  beforeEach(() => {
    localStorage.clear();
    setViewport(360, 640);
  });

  it('критерий: на 360×640, 390×844, 1440×900 и 1920×1080 нет прокрутки, ник, образец цвета и «Играть» видны сразу', () => {
    for (const viewport of VIEWPORTS) {
      cleanup();
      setViewport(viewport.width, viewport.height);
      renderMenu();

      expect(
        document.documentElement.scrollWidth,
        `${viewport.width}×${viewport.height}`,
      ).toBeLessThanOrEqual(viewport.width);
      expect(
        document.documentElement.scrollHeight,
        `${viewport.width}×${viewport.height}`,
      ).toBeLessThanOrEqual(viewport.height);
      expectVisible(screen.getByRole('textbox'));
      expectVisible(screen.getByRole('button', { name: 'Играть' }));
      expect(colorButtons()).toHaveLength(1);
    }
  });

  it('критерий: блок «Как играть» убран совсем, рядом с ником остаётся один образец текущего цвета', () => {
    renderMenu();

    expect(screen.queryByText('Как играть')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Как играть' })).toBeNull();

    const input = screen.getByRole('textbox');
    const [swatch] = colorButtons();
    expect(swatch).toBeDefined();
    expect(input.parentElement?.parentElement?.contains(swatch as HTMLButtonElement)).toBe(true);
  });

  it('критерий: клик по образцу открывает компактный селектор с кругами ⌀28 по 6 в ряд, выбор и клик вне закрывают его', () => {
    renderMenu();
    const [swatch] = colorButtons();
    expect(swatch).toBeDefined();
    if (swatch === undefined) return;

    fireEvent.click(swatch);
    const options = colorButtons();
    expect(options).toHaveLength(24);
    for (const option of options) {
      expect(getComputedStyle(option).width).toBe('28px');
      expect(getComputedStyle(option).height).toBe('28px');
    }

    const picker = options[0]?.parentElement;
    expect(picker).not.toBeNull();
    if (picker === null || picker === undefined) return;
    expect(getComputedStyle(picker).gridTemplateColumns.split(/\s+/u).filter(Boolean)).toHaveLength(
      6,
    );

    fireEvent.click(options[1] as HTMLButtonElement);
    expect(colorButtons()).toHaveLength(1);

    const [selectedSwatch] = colorButtons();
    expect(selectedSwatch).toBeDefined();
    if (selectedSwatch === undefined) return;
    fireEvent.click(selectedSwatch);
    expect(colorButtons()).toHaveLength(24);
    fireEvent.mouseDown(document.body);
    expect(colorButtons()).toHaveLength(1);
  });
});
