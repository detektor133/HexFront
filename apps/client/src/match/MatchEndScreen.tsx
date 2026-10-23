import { useState } from 'react';

import type { WinReason } from '@hexfront/sim';

import { t } from '../i18n/dict.ts';
import { formatFp, formatSoldiers } from '../i18n/format.ts';

interface VictoryHoldView {
  readonly player: number;
  readonly seconds: number;
}

export interface MatchEndScreenProps {
  readonly soldiers: number;
  readonly gold: number;
  readonly winner: number;
  readonly playerId: number;
  readonly playerName?: string;
  readonly place: number;
  readonly eliminated: boolean;
  readonly fog: boolean;
  readonly reason?: WinReason;
  readonly victoryHold?: VictoryHoldView | null;
  readonly onWatch: (message: { readonly type: 'setFog'; readonly enabled: boolean }) => void;
  readonly onMenu: (path: string) => void;
}

function victoryReason(reason: WinReason | undefined): string {
  if (reason === 'cities') return t('match.reason.cities');
  if (reason === 'lastStanding') return t('match.reason.lastStanding');
  return t('match.reason.score');
}

function holdClock(seconds: number): string {
  return `00:${String(Math.max(0, seconds)).padStart(2, '0')}`;
}

export function MatchEndScreen(props: MatchEndScreenProps): React.JSX.Element | null {
  const [watching, setWatching] = useState(false);
  if (watching || (props.winner < 0 && !props.eliminated && !props.victoryHold)) return null;
  const eliminated = props.eliminated;
  const result = eliminated
    ? [
        <h2 key="title">{`${t('match.eliminated')} · ${t('match.placeLower')} ${props.place}`}</h2>,
        <button
          key="watch"
          type="button"
          onClick={() => {
            props.onWatch({ type: 'setFog', enabled: false });
            setWatching(true);
          }}
        >
          {t('match.observe')}
        </button>,
        <button key="menu" type="button" onClick={() => props.onMenu('/')}>
          {t('match.mainMenu')}
        </button>,
      ]
    : props.winner >= 0
      ? [
          <h2 key="title">{t('match.won')}</h2>,
          <p key="reason">{victoryReason(props.reason)}</p>,
          <button key="menu" type="button" onClick={() => props.onMenu('/')}>
            {t('pause.menu')}
          </button>,
        ]
      : [];
  return (
    <section aria-label={t('match.end')}>
      {[
        ...result,
        <p key="name">{props.playerName ?? `${t('observer.player')} ${props.playerId + 1}`}</p>,
        <p key="soldiers">{formatSoldiers(props.soldiers)}</p>,
        <p key="gold">{formatFp(props.gold)}</p>,
        ...(props.victoryHold
          ? [
              <p key="victory-hold">
                {`${t('leaderboard.player')} ${props.victoryHold.player} ${t('match.holdsCities')} · ${holdClock(props.victoryHold.seconds)}`}
              </p>,
            ]
          : []),
      ]}
    </section>
  );
}
