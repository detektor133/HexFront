import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Fp, PlayerView } from '@hexfront/sim';

import { Leaderboard } from '../src/dev/Leaderboard.tsx';

type Ranking = readonly { readonly id: number; readonly score: number; readonly place: number }[];
type RankingView = PlayerView & { readonly ranking: Ranking };

const view = (): RankingView =>
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
  }) as RankingView;

describe('лидерборд', () => {
  afterEach(() => {
    cleanup();
  });

  it('критерий: место в свёрнутом лидерборде совпадает с местом в HUD', () => {
    render(<Leaderboard view={view()} open={false} />);

    expect(screen.getByRole('button').textContent).toContain('#6 / 6');
  });

  it('критерий: после клика есть ровно 5 строк топа плюс своя строка при месте > 5', () => {
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      return <Leaderboard view={view()} open={open} onOpenChange={setOpen} />;
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getAllByRole('row')).toHaveLength(7);
    expect(screen.getAllByRole('rowheader')).toHaveLength(6);
  });

  it('критерий: в лидерборде нет колонок золота и солдат', () => {
    render(<Leaderboard view={view()} />);

    expect(screen.queryByRole('columnheader', { name: 'Золото' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Солдаты' })).toBeNull();
  });
});
