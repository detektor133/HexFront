import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MainMenu } from '../src/menu/MainMenu.tsx';

type WorkerMessage = Record<string, unknown>;

class FakeWorker {
  public readonly messages: WorkerMessage[] = [];
  public terminate = vi.fn();

  public postMessage(message: WorkerMessage): void {
    this.messages.push(message);
  }

  public addEventListener(): void {}

  public removeEventListener(): void {}
}

let workers: FakeWorker[] = [];

function renderMenu(): void {
  vi.stubGlobal(
    'Worker',
    class extends FakeWorker {
      public constructor() {
        super();
        workers.push(this);
      }
    },
  );
  render(<MainMenu />);
}

function containsValue(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsValue(item, expected));
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some((item) => containsValue(item, expected));
}

function hasMessageValue(expected: unknown): boolean {
  return workers.some((worker) =>
    worker.messages.some((message) => containsValue(message, expected)),
  );
}

describe('главное меню', () => {
  beforeEach(() => {
    workers = [];
    localStorage.clear();
    vi.stubGlobal('Worker', undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('критерий: фон меню запускается на карте small с 6 ботами, без тумана и на скорости 1×', () => {
    renderMenu();

    expect(hasMessageValue('small')).toBe(true);
    expect(hasMessageValue(6)).toBe(true);
    expect(hasMessageValue(false)).toBe(true);
    expect(hasMessageValue(1)).toBe(true);
  });

  it('критерий: в меню нет text-transform: uppercase', () => {
    renderMenu();

    expect(document.body.textContent).toContain('Hexfront');
    expect(document.body.innerHTML).not.toMatch(/text-transform:\s*uppercase/iu);
  });

  it('критерий: ник длиннее 16 символов обрезается', () => {
    renderMenu();
    const input = screen.queryByRole('textbox');

    expect(input).not.toBeNull();
    if (input === null) return;

    fireEvent.change(input, { target: { value: 'АБВГДЕЁЖЗИЙКЛМНОПР' } });

    expect(input).toHaveValue('АБВГДЕЁЖЗИЙКЛМНО');
  });

  it('критерий: выбранный цвет применяется к игроку, а прежний цвет передаётся игроку, у которого он был', () => {
    renderMenu();
    const colors = screen.queryAllByRole('button', { name: /цвет/iu });

    expect(colors.length).toBeGreaterThan(1);
    const selectedColor = colors[1];
    if (selectedColor === undefined) return;
    fireEvent.click(selectedColor);
    fireEvent.click(screen.getByRole('button', { name: 'Играть' }));

    expect(hasMessageValue('brick')).toBe(true);
    expect(hasMessageValue('teal')).toBe(true);
  });

  it('критерий: «Автокомандование» из настроек отправляет setAutoCommand при старте матча', () => {
    renderMenu();
    const autoCommand = screen.queryByRole('button', { name: /Автокомандование/iu });

    expect(autoCommand).not.toBeNull();
    if (autoCommand === null) return;
    fireEvent.click(autoCommand);
    fireEvent.click(screen.getByRole('button', { name: 'Играть' }));

    expect(hasMessageValue('setAutoCommand')).toBe(true);
  });

  it('критерий: «На весь экран» скрыта без Fullscreen API', () => {
    renderMenu();

    expect(screen.queryByText('На весь экран')).toBeNull();
  });

  it('критерий: размонтирование меню вызывает terminate() воркера фонового матча', () => {
    renderMenu();
    cleanup();

    expect(workers.some((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
});
