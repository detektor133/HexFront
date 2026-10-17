import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MainMenu } from '../src/menu/MainMenu.tsx';

const mainMenuCss = readFileSync('apps/client/src/menu/MainMenu.module.css', 'utf8');

class FakeWorker {
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  public onerror: ((event: ErrorEvent) => void) | null = null;

  public postMessage(): void {}

  public addEventListener(): void {}

  public removeEventListener(): void {}

  public terminate(): void {}
}

function renderMenu(): void {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
  render(<MainMenu />);
}

function colorButtons(): HTMLButtonElement[] {
  return screen.getAllByRole('button', { name: /^Цвет /u }) as HTMLButtonElement[];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('приёмка 07/T17p: компактное главное меню', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('скрывает настройки и сохраняет auto из localStorage в ссылке и при старте матча', () => {
    localStorage.setItem('hexfront.auto-command', 'true');
    renderMenu();

    expect(screen.queryByRole('heading', { name: 'Настройки' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Автокомандование/iu })).toBeNull();
    expect(screen.queryByRole('button', { name: 'На весь экран' })).toBeNull();

    const play = screen.getByRole('button', { name: 'Играть' });
    expect(play.getAttribute('href')).toContain('auto=1');
    fireEvent.click(play);
    expect(localStorage.getItem('hexfront.auto-command')).toBe('true');
  });

  it('размещает выбранный цвет слева от ника, ограничивает ник 16 символами и растягивает «Играть»', () => {
    renderMenu();

    const input = screen.getByRole('textbox');
    const swatch = colorButtons()[0];
    expect(swatch).toBeDefined();
    if (swatch === undefined) return;
    expect(swatch.parentElement?.nextElementSibling).toBe(input.parentElement);
    expect(input.getAttribute('maxlength')).toBe('16');
    expect(swatch.className).toMatch(/selected/u);
    expect(swatch.getAttribute('aria-label')).toBe('Цвет teal');
    expect(mainMenuCss).toMatch(/\.identityRow\s*\{[\s\S]*display:\s*flex/u);
    expect(mainMenuCss).toMatch(/\.play\s*\{[\s\S]*width:\s*100%/u);
    expect(mainMenuCss).toMatch(/\.color:hover\s*\{/u);
    expect(mainMenuCss).toMatch(/\.color:focus-visible\s*\{/u);
    expect(mainMenuCss).toMatch(/\.color\.selected\s*\{/u);
  });

  it('открывает палитру поверх потока, выбирает цвет и закрывает её вне области', () => {
    renderMenu();
    const initialCard = screen.getByRole('region', { name: 'Быстрый матч' });
    const initialPlay = screen.getByRole('button', { name: 'Играть' });
    const swatch = colorButtons()[0];
    expect(swatch).toBeDefined();
    if (swatch === undefined) return;

    fireEvent.click(swatch);
    const options = colorButtons();
    expect(options).toHaveLength(24);
    expect(options[0]?.parentElement?.className).toMatch(/palette/u);
    expect(mainMenuCss).toMatch(/\.palette\s*\{[\s\S]*position:\s*absolute/u);
    expect(screen.getByRole('region', { name: 'Быстрый матч' })).toBe(initialCard);
    expect(screen.getByRole('button', { name: 'Играть' })).toBe(initialPlay);
    expect(mainMenuCss).toMatch(/\.palette\s*\{[\s\S]*position:\s*absolute/u);
    expect(mainMenuCss).toMatch(/\.palette\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,/u);
    expect(mainMenuCss).toMatch(/\.color\s*\{[\s\S]*width:\s*28px[\s\S]*height:\s*28px/u);

    fireEvent.click(options[1] as HTMLButtonElement);
    expect(colorButtons()).toHaveLength(1);
    fireEvent.click(colorButtons()[0] as HTMLButtonElement);
    expect(colorButtons()).toHaveLength(24);
    fireEvent.mouseDown(document.body);
    expect(colorButtons()).toHaveLength(1);
  });
});
