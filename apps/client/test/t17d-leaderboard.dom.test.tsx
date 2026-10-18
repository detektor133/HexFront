// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Fp, PlayerView } from '@hexfront/sim';

import { Leaderboard } from '../src/dev/Leaderboard.tsx';

type RankingView = PlayerView & {
  readonly ranking: readonly {
    readonly id: number;
    readonly score: number;
    readonly place: number;
  }[];
};

function view(): RankingView {
  return {
    tick: 0,
    winner: -1,
    playerId: 5,
    ranking: Array.from({ length: 6 }, (_, id) => ({
      id,
      score: 60 - id * 10,
      place: id + 1,
    })),
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
      status: id < 4 ? ('alive' as const) : ('eliminated' as const),
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
  } as RankingView;
}

describe('07/T17d: таблица лидеров', () => {
  afterEach(() => {
    cleanup();
  });

  it('критерий: список содержит только место, игрока и счёт', () => {
    render(<Leaderboard view={view()} />);

    expect(screen.queryByRole('columnheader')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getAllByRole('rowheader')).toHaveLength(5);
    expect(screen.getAllByRole('cell')).toHaveLength(10);
    expect(screen.queryByText('Гексы')).toBeNull();
    expect(screen.queryByText('Города')).toBeNull();
    expect(screen.queryByText('Золото')).toBeNull();
    expect(screen.queryByText('Солдаты')).toBeNull();
  });

  it('критерий: таблица показывает не больше 5 строк игроков', () => {
    render(<Leaderboard view={view()} />);

    expect(screen.getAllByRole('rowheader')).toHaveLength(5);
  });

  it('критерий: отдельная строка «Живы: N» показывает число живых игроков без «из M»', () => {
    render(<Leaderboard view={view()} />);

    expect(screen.getByText('Живы: 4')).toBeTruthy();
    expect(screen.queryByText(/из/iu)).toBeNull();
  });

  it('критерий: заголовок «Таблица лидеров» выведен ровно один раз', () => {
    render(<Leaderboard view={view()} />);

    expect(screen.getAllByText('Таблица лидеров')).toHaveLength(1);
  });
});
