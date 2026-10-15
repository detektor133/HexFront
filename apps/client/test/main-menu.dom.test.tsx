import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startLocalMatch } from '../src/local/local-match.ts';
import { MainMenu } from '../src/menu/MainMenu.tsx';
import { playerColorIds } from '../src/theme/colors.ts';

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

function startMessages(worker: FakeWorker): WorkerMessage[] {
  return worker.messages.filter((message) => message.t === 'start');
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

    expect(workers).toHaveLength(1);
    expect(startMessages(workers[0] as FakeWorker)).toEqual([
      expect.objectContaining({
        map: 'small',
        players: 6,
        bots: [0, 1, 2, 3, 4, 5],
        fog: false,
        speed: 1,
      }),
    ]);
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

    const latestWorker = workers.at(-1);
    expect(latestWorker).toBeDefined();
    expect(startMessages(latestWorker as FakeWorker)[0]).toEqual(
      expect.objectContaining({ playerColors: ['brick', 'teal'] }),
    );
  });

  it('критерий: «Автокомандование» из настроек отправляет setAutoCommand при старте матча', () => {
    renderMenu();
    const autoCommand = screen.queryByRole('button', { name: /Автокомандование/iu });

    expect(autoCommand).not.toBeNull();
    if (autoCommand === null) return;
    fireEvent.click(autoCommand);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Адмирал' } });
    const play = screen.getByRole('button', { name: 'Играть' });
    fireEvent.click(play);

    expect(localStorage.getItem('hexfront.auto-command')).toBe('true');
    expect(localStorage.getItem('hexfront.nickname')).toBe('Адмирал');
    expect(play.getAttribute('href')).toContain('name=%D0%90%D0%B4%D0%BC%D0%B8%D1%80%D0%B0%D0%BB');
    expect(workers.flatMap((worker) => worker.messages)).not.toContainEqual(
      expect.objectContaining({ t: 'command' }),
    );

    const game = startLocalMatch(
      'small',
      1,
      { count: 6, bots: [1, 2, 3, 4, 5], speed: 1 },
      () => undefined,
      {
        playerName: localStorage.getItem('hexfront.nickname') ?? '',
        playerColors: playerColorIds('brick'),
        autoCommand: localStorage.getItem('hexfront.auto-command') === 'true',
      },
    );
    const gameWorker = workers.at(-1);
    expect(gameWorker).toBeDefined();
    expect(startMessages(gameWorker as FakeWorker)[0]).toEqual(
      expect.objectContaining({
        playerName: 'Адмирал',
        playerColors: expect.arrayContaining(['brick', 'teal']),
      }),
    );
    expect(gameWorker?.messages).toContainEqual({
      t: 'command',
      cmd: { t: 'setAutoCommand', on: true },
    });
    game.dispose();
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
