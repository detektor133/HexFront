import { useEffect, useState } from 'react';

import type { GameEvent } from '@hexfront/sim';

import styles from './EventFeed.module.css';
import type { EventFeedItem } from './event-feed.ts';
import { visibleEvents } from './event-feed.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';

function label(event: GameEvent): string {
  return t(`event.${event.t}` as Parameters<typeof t>[0]);
}

export function EventFeed(props: {
  readonly items: readonly EventFeedItem[];
  readonly now: number;
  readonly onFocus: (item: EventFeedItem) => void;
}): React.JSX.Element | null {
  const [, redraw] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => redraw((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);
  const items = visibleEvents(props.items, props.now);
  if (items.length === 0) return null;
  return (
    <div className={styles.feed} aria-label={t('event.feed')}>
      {items.map((item) => (
        <button
          className={`${styles.item} ${item.important ? styles.important : ''}`}
          key={item.id}
          type="button"
          onClick={() => props.onFocus(item)}
        >
          <span
            className={styles.owner}
            style={{
              background: tokens.players.palette[item.event.playerId]?.line ?? tokens.ui.ink,
            }}
          />
          <span>{label(item.event)}</span>
        </button>
      ))}
    </div>
  );
}
