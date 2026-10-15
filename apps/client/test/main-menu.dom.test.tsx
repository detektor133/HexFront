import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MatchPage } from '../src/match/MatchPage.tsx';
import { MainMenu } from '../src/menu/MainMenu.tsx';
import * as mapViewModule from '../src/render/map-view.ts';

type WorkerMessage = Record<string, unknown>;

class FakeWorker {
  public readonly messages: WorkerMessage[] = [];
  public terminate = vi.fn();
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;

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

function fakeMapView(): mapViewModule.MapView {
  return {
    destroy: vi.fn(),
    setBottomInset: vi.fn(),
    setTopInset: vi.fn(),
    setGrab: vi.fn(),
    setOrderHooks: vi.fn(),
    setSelection: vi.fn(),
    setScale: vi.fn(),
    centerOn: vi.fn(),
  } as unknown as mapViewModule.MapView;
}

async function renderGame(url: string): Promise<FakeWorker> {
  const expectedWorkerCount = workers.length + 1;
  const map = JSON.parse(readFileSync('packages/mapgen/maps/small.json', 'utf8')) as unknown;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => map })),
  );
  vi.spyOn(mapViewModule, 'createMapView').mockResolvedValue(fakeMapView());
  window.history.pushState({}, '', url);
  render(<MatchPage />);
  await waitFor(() =>
    expect(
      workers.length >= expectedWorkerCount &&
        workers.at(-1)?.messages.some((message) => message.t === 'start'),
    ).toBe(true),
  );
  return workers.at(-1) as FakeWorker;
}

describe('главное меню', () => {
  beforeEach(() => {
    workers = [];
    localStorage.clear();
    vi.stubGlobal('Worker', undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
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
    const initialWorker = workers[0];
    expect(initialWorker).toBeDefined();
    if (initialWorker === undefined) return;

    expect(startMessages(initialWorker)[0]).toEqual(
      expect.objectContaining({ playerColors: ['teal', 'brick'] }),
    );
    const selectedColor = screen.getByRole('button', { name: 'Цвет brick' });
    fireEvent.click(selectedColor);

    expect(workers).toHaveLength(2);
    const changedWorker = workers[1];
    expect(changedWorker).toBeDefined();
    if (changedWorker === undefined) return;
    expect(changedWorker).not.toBe(initialWorker);
    expect(startMessages(changedWorker)[0]).toEqual(
      expect.objectContaining({ playerColors: ['brick', 'teal'] }),
    );
  });

  it('критерий: настройки меню применяются игровому Worker после перехода по ссылке', async () => {
    renderMenu();
    const selectedColor = screen.getByRole('button', { name: 'Цвет brick' });
    fireEvent.click(selectedColor);
    const autoCommand = screen.queryByRole('button', { name: /Автокомандование/iu });

    expect(autoCommand).not.toBeNull();
    if (autoCommand === null) return;
    fireEvent.click(autoCommand);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Адмирал' } });
    const play = screen.getByRole('button', { name: 'Играть' });
    fireEvent.click(play);
    const menuWorkers = [...workers];

    expect(localStorage.getItem('hexfront.auto-command')).toBe('true');
    expect(localStorage.getItem('hexfront.nickname')).toBe('Адмирал');
    expect(play.getAttribute('href')).toContain('name=%D0%90%D0%B4%D0%BC%D0%B8%D1%80%D0%B0%D0%BB');
    cleanup();

    const gameWorker = await renderGame(play.getAttribute('href') ?? '/match');
    expect(menuWorkers).not.toContain(gameWorker);
    const start = startMessages(gameWorker)[0];
    expect(start).toEqual(expect.objectContaining({ playerName: 'Адмирал' }));
    expect((start?.playerColors as string[]).slice(0, 2)).toEqual(['brick', 'teal']);
    expect(gameWorker?.messages).toContainEqual({
      t: 'command',
      cmd: { t: 'setAutoCommand', on: true },
    });
  });

  it('критерий: пустой ник получает имя «Игрок 1» в игровом Worker', async () => {
    renderMenu();
    const play = screen.getByRole('button', { name: 'Играть' });
    const url = play.getAttribute('href');
    expect(url).not.toBeNull();
    if (url === null) return;

    cleanup();
    const gameWorker = await renderGame(url);

    expect(startMessages(gameWorker)[0]).toEqual(
      expect.objectContaining({ playerName: 'Игрок 1' }),
    );
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
