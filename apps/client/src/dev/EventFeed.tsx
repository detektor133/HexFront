import { useEffect, useState } from 'react';

import type { GameEvent } from '@hexfront/sim';

import styles from './EventFeed.module.css';
import type { EventFeedItem } from './event-feed.ts';
import { visibleEvents } from './event-feed.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';

function assertNever(value: never): never {
  throw new Error(`Неизвестное событие: ${String(value)}`);
}

export function eventLabel(event: GameEvent['t']): Parameters<typeof t>[0] {
  switch (event) {
    case 'cityCaptured':
    case 'commandRejected':
    case 'unitRecruited':
    case 'recruitCancelled':
    case 'unitDestroyed':
    case 'unitRetreated':
    case 'unitCapitulated':
    case 'capitalMoved':
    case 'playerEliminated':
    case 'offensiveDone':
    case 'matchWon':
    case 'constructionDone':
    case 'constructionCancelled':
      return `event.${event}`;
    default:
      return assertNever(event);
  }
}

function label(event: GameEvent, localPlayerId: number): string {
  if (event.t === 'cityCaptured') {
    return t(event.newOwnerId === localPlayerId ? 'event.cityCaptured' : 'event.cityLost');
  }
  return t(eventLabel(event.t));
}

export function EventFeed(props: {
  readonly items: readonly EventFeedItem[];
  readonly localPlayerId?: number;
  readonly now: number;
  readonly onFocus: (item: EventFeedItem) => void;
  readonly style?: React.CSSProperties | undefined;
}): React.JSX.Element | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => redraw((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);
  const items = visibleEvents(props.items, props.now);
  if (items.length === 0) return null;
  return (
    <div className={styles.feed} style={props.style} aria-label={t('event.feed')}>
      {items.map((item) => (
        <button
          className={`${styles.item} ${item.important ? styles.important : ''}`}
          key={item.id}
          type="button"
          onClick={() => {
            if (item.hex !== null) props.onFocus(item);
          }}
        >
          <span
            className={styles.owner}
            style={{
              background: tokens.players.palette[item.event.playerId]?.line ?? tokens.ui.ink,
            }}
          />
          <span>{label(item.event, props.localPlayerId ?? 0)}</span>
        </button>
      ))}
    </div>
  );
}
