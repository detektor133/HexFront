import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MainMenu } from '../src/menu/MainMenu.tsx';

type WorkerMessage = Record<string, unknown>;

const mainMenuCss = readFileSync('apps/client/src/menu/MainMenu.module.css', 'utf8');

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

function cssRule(selector: string): string {
  const match = mainMenuCss.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 'u'));
  expect(match, `CSS rule .${selector}`).not.toBeNull();
  return match?.[1] ?? '';
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

  it('критерий: на 360×640, 390×844, 1440×900 и 1920×1080 раскладка не создаёт прокрутку, ник, образец цвета и «Играть» видны сразу', () => {
    const pageRule = cssRule('page');
    const cardRule = cssRule('card');
    expect(pageRule).toMatch(/overflow:\s*hidden/u);
    expect(pageRule).toMatch(/min-height:\s*100%/u);
    expect(pageRule).toMatch(/box-sizing:\s*border-box/u);
    expect(cardRule).toMatch(/width:\s*min\(100%,\s*420px\)/u);
    expect(cardRule).toMatch(/box-sizing:\s*border-box/u);

    for (const viewport of VIEWPORTS) {
      cleanup();
      setViewport(viewport.width, viewport.height);
      renderMenu();

      expectVisible(screen.getByRole('textbox'));
      expectVisible(screen.getByRole('button', { name: 'Играть' }));
      expect(colorButtons()).toHaveLength(1);
      const [swatch] = colorButtons();
      expect(swatch).toBeDefined();
      if (swatch === undefined) continue;
      expectVisible(swatch);
    }
  });

  it('критерий: блок «Как играть» убран совсем, рядом с ником остаётся один образец текущего цвета', () => {
    renderMenu();

    expect(screen.queryByText('Как играть')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Как играть' })).toBeNull();

    const input = screen.getByRole('textbox');
    const [swatch] = colorButtons();
    expect(swatch).toBeDefined();
    if (swatch === undefined) return;
    expectVisible(swatch);
    expect(input.closest('label')?.nextElementSibling).toBe(swatch.closest('div')?.parentElement);
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
