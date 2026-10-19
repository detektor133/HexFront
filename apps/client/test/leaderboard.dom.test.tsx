import { readFileSync } from 'node:fs';

import { cleanup, isInaccessible, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Fp, PlayerView } from '@hexfront/sim';

import { installPanelStyles } from './panel-css.ts';
import { Leaderboard } from '../src/dev/Leaderboard.tsx';

type Ranking = readonly { readonly id: number; readonly score: number; readonly place: number }[];
type RankingView = PlayerView & { readonly ranking: Ranking };

const view = (overrides: Partial<RankingView> = {}): RankingView =>
  ({
    tick: 0,
    winner: -1,
    playerId: 5,
    ranking: [
      { id: 0, score: 60, place: 1 },
      { id: 1, score: 50, place: 2 },
      { id: 2, score: 40, place: 3 },
      { id: 3, score: 30, place: 4 },
      { id: 4, score: 20, place: 5 },
      { id: 5, score: 10, place: 6 },
    ],
    hexes: {
      owner: Int16Array.from([]),
      pop: new Int32Array(),
      improvement: new Uint8Array(),
      building: new Uint8Array(),
      road: new Uint8Array(),
      link: new Uint8Array(),
      growth: new Int32Array(),
      visible: new Uint8Array(),
    },
    cities: [],
    units: [],
    armies: [],
    plans: [],
    players: Array.from({ length: 6 }, (_, id) => ({
      id,
      gold: 0 as Fp,
      taxTarget: 0 as Fp,
      taxEffective: 0 as Fp,
      status: 'alive' as const,
    })),
    me: {
      popTotal: 0,
      popGrowthPerS: 0,
      incomePerS: 0,
      incomeAtTargetPerS: 0,
      upkeepPerS: 0,
      supplyLevel: 1000 as Fp,
      bankrupt: false,
      autoReinforce: true,
      autoCommand: true,
      foundCityCost: 0 as Fp,
      growthMultAtTarget: 1000 as Fp,
      score: 10,
      place: 6,
      players: 6,
    },
    constructions: [],
    recruits: [],
    ...overrides,
  }) as RankingView;

describe('лидерборд', () => {
  let removeStyles: () => void;
  beforeEach(() => {
    removeStyles = installPanelStyles();
  });
  afterEach(() => {
    removeStyles();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    'передаёт внешний размер панели из ResizeObserver (borderBoxSize: %s)',
    (borderBox) => {
      let panelSize = { width: 150, height: 138 };
      class Observer {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element, options?: ResizeObserverOptions): void {
          expect(options?.box).toBe('border-box');
          this.callback(
            [
              {
                target,
                contentRect: new DOMRect(0, 0, panelSize.width - 14, panelSize.height - 14),
                borderBoxSize: borderBox
                  ? [{ inlineSize: panelSize.width, blockSize: panelSize.height }]
                  : [],
              } as unknown as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        disconnect(): void {}
      }
      vi.stubGlobal('ResizeObserver', Observer);
      const onSize = vi.fn();

      render(<Leaderboard view={view()} onSize={onSize} />);
      expect(onSize).toHaveBeenLastCalledWith({ width: 150, height: 138 });

      cleanup();
      panelSize = { width: 174, height: 142 };
      render(<Leaderboard view={view()} onSize={onSize} />);

      expect(onSize).toHaveBeenLastCalledWith({ width: 174, height: 142 });
      expect(onSize.mock.calls.map(([size]) => size)).toEqual([
        { width: 150, height: 138 },
        { width: 174, height: 142 },
      ]);
    },
  );

  it('критерий 07/T17s: на ПК лидерборд видим без кнопки сворачивания', () => {
    render(<Leaderboard view={view()} open={false} />);

    expect(screen.getByRole('region', { name: 'Таблица лидеров' })).toBeTruthy();
    expect(screen.getByText('Таблица лидеров')).toBeTruthy();
    expect(screen.getByText('Живы: 6')).toBeTruthy();
    expect(isInaccessible(screen.getByText('Таблица лидеров'))).toBe(false);
    expect(isInaccessible(screen.getByText('Живы: 6'))).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('критерий 07/T17s: пять строк остаются видимыми постоянно', () => {
    render(<Leaderboard view={view()} open={false} />);

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(screen.getAllByRole('rowheader')).toHaveLength(5);

    const expected = [
      { player: 'Игрок 1', place: '1', score: '60' },
      { player: 'Игрок 2', place: '2', score: '50' },
      { player: 'Игрок 3', place: '3', score: '40' },
      { player: 'Игрок 4', place: '4', score: '30' },
      { player: 'Игрок 5', place: '5', score: '20' },
    ];

    expected.forEach((entry, index) => {
      const row = within(rows[index] as HTMLElement);
      expect(row.getByRole('rowheader', { name: entry.place })).toBeTruthy();
      expect(row.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
        entry.player,
        entry.score,
      ]);
    });
  });

  it('критерий: в лидерборде нет колонок золота и солдат', () => {
    render(<Leaderboard view={view()} />);

    expect(screen.queryByRole('columnheader')).toBeNull();
    expect(screen.queryByRole('rowgroup')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Золото' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Солдаты' })).toBeNull();
  });

  it('критерий 07/T17s: обновляет строки после изменения снимка', () => {
    const initial = view();
    const updated = view({
      ranking: [{ id: 0, score: 99, place: 1 }, ...initial.ranking.slice(1)],
    });

    const { rerender } = render(<Leaderboard view={initial} />);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toContain('60');

    rerender(<Leaderboard view={updated} />);
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toContain('99');
  });

  it('критерий 07/T17s: длинное имя сокращается многоточием', () => {
    const source = view();
    const namedView = {
      ...source,
      ranking: [{ id: 0, score: 123456789, place: 6 }, ...source.ranking.slice(1)],
      players: source.players.map((player, id) =>
        id === 0 ? { ...player, name: 'Очень длинное имя игрока' } : player,
      ),
    } as RankingView;

    render(<Leaderboard view={namedView} />);

    const [player] = within(screen.getAllByRole('row')[0] as HTMLElement).getAllByRole('cell');
    if (!player) throw new Error('Строка игрока не найдена');
    expect(player.className).toContain('player');
    expect(player.textContent).toBe('Очень длинное имя игрока');
    expect(player.title).toBe('Очень длинное имя игрока');
    expect(getComputedStyle(player).textOverflow).toBe('ellipsis');
    const row = screen.getAllByRole('row')[0] as HTMLElement;
    const score = within(row).getAllByRole('cell')[1];
    expect(score?.textContent).toBe('123456789');
    if (!score) throw new Error('Полный счёт не найден');
    expect(getComputedStyle(score).textOverflow).not.toBe('ellipsis');
    const scoreStyle = getComputedStyle(score);
    for (const overflow of [scoreStyle.overflow, scoreStyle.overflowX, scoreStyle.overflowY]) {
      expect(['', 'visible']).toContain(overflow);
    }
    expect(within(row).getByRole('rowheader')).not.toBe(within(row).getAllByRole('cell')[1]);
    const stylesheet = readFileSync('apps/client/src/dev/Leaderboard.module.css', 'utf8');
    expect(stylesheet).toMatch(/text-overflow:\s*ellipsis/u);
    expect(stylesheet).toMatch(
      /grid-template-columns:\s*max-content\s+minmax\(0,\s*12ch\)\s+max-content/u,
    );
    expect(stylesheet).toMatch(/\.place,\s*\.score\s*\{[\s\S]*white-space:\s*nowrap/u);
    expect(stylesheet).toMatch(
      /\.row\s*\{[\s\S]*grid-template-columns:\s*max-content\s+minmax\(0,\s*12ch\)\s+max-content/u,
    );
    expect(within(row).getByRole('rowheader').className).toContain('place');
    expect(within(row).getAllByRole('cell')[1]?.className).toContain('score');
  });

  it('сортирует по очкам и id, считает общий ранг и не меняет игровые place', () => {
    const source = view({
      ranking: [
        { id: 2, score: 40, place: 91 },
        { id: 0, score: 70, place: 42 },
        { id: 3, score: 40, place: 7 },
        { id: 1, score: 70, place: 12 },
      ],
      players: Array.from({ length: 4 }, (_, id) => ({
        id,
        name: `Игрок ${id + 1}`,
        gold: 0 as Fp,
        taxTarget: 0 as Fp,
        taxEffective: 0 as Fp,
        status: 'alive' as const,
      })),
    });
    const original = structuredClone(source.ranking);
    render(<Leaderboard view={source} />);

    const rows = screen.getAllByRole('row');
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Игрок 1',
      'Игрок 2',
      'Игрок 3',
      'Игрок 4',
    ]);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      '1',
      '1',
      '3',
      '3',
    ]);
    expect(source.ranking).toEqual(original);
    expect(source.ranking.map((row) => row.place)).toEqual([91, 42, 7, 12]);
  });

  it('критерий 07/T17i: при 30 игроках показывает не более пяти строк игроков', () => {
    const source = view();
    const largeView = {
      ...source,
      ranking: Array.from({ length: 30 }, (_, index) => {
        const id = 29 - index;
        return { id, score: id < 2 ? 30 : id < 4 ? 20 : 10 - id, place: index + 10 };
      }),
      players: Array.from({ length: 30 }, (_, id) => ({
        id,
        gold: 0 as Fp,
        taxTarget: 0 as Fp,
        taxEffective: 0 as Fp,
        status: 'alive' as const,
      })),
    } as RankingView;

    const originalRanking = structuredClone(largeView.ranking);
    const originalPlace = largeView.me.place;
    render(<Leaderboard view={largeView} />);

    expect(screen.getAllByRole('rowheader')).toHaveLength(5);
    expect(screen.getByText('Живы: 30')).toBeTruthy();
    expect(screen.queryByText('Игрок 6')).toBeNull();

    const rows = screen.getAllByRole('row');
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['Игрок 1', '30'],
      ['Игрок 2', '30'],
      ['Игрок 3', '20'],
      ['Игрок 4', '20'],
      ['Игрок 5', '6'],
    ]);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      '1',
      '1',
      '3',
      '3',
      '5',
    ]);
    expect(largeView.ranking).toEqual(originalRanking);
    expect(largeView.me.place).toBe(originalPlace);
  });
});
