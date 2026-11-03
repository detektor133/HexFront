import {
  IconArrowBackUp,
  IconBuildingCastle,
  IconFlag,
  IconHeartHandshake,
  IconLinkOff,
  IconSkull,
  IconSwords,
} from '@tabler/icons-react';
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
    case 'warDeclared':
    case 'treatyMade':
    case 'treatyBroken':
    case 'treatyOffered':
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

/** Иконка записи вместо текстовой подписи; текст остаётся в title и aria-label. */
function EventIcon(props: { readonly event: GameEvent; readonly localPlayerId: number }) {
  const { event } = props;
  if (event.t === 'unitDestroyed') return <IconSkull size={18} aria-hidden />;
  if (event.t === 'unitCapitulated') return <IconFlag size={18} aria-hidden />;
  if (event.t === 'unitRetreated') return <IconArrowBackUp size={18} aria-hidden />;
  if (event.t === 'cityCaptured') return <IconBuildingCastle size={18} aria-hidden />;
  if (event.t === 'warDeclared') return <IconSwords size={18} aria-hidden />;
  if (event.t === 'treatyMade' || event.t === 'treatyOffered') {
    return <IconHeartHandshake size={18} aria-hidden />;
  }
  if (event.t === 'treatyBroken') return <IconLinkOff size={18} aria-hidden />;
  return null;
}

export function EventFeed(props: {
  readonly items: readonly EventFeedItem[];
  readonly localPlayerId?: number;
  readonly now: number;
  readonly onFocus: (item: EventFeedItem) => void;
  readonly style?: React.CSSProperties | undefined;
}): React.JSX.Element | null {
  const [now, setNow] = useState<number>(props.now);
  useEffect(() => {
    setNow(props.now);
  }, [props.now]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const items = visibleEvents(props.items, now);
  if (items.length === 0) return null;
  return (
    <div className={styles.feed} style={props.style} aria-label={t('event.feed')}>
      {items.map((item) =>
        (() => {
          const content = (
            <>
              <span
                className={styles.owner}
                style={{
                  background: tokens.players.palette[item.event.playerId]?.line ?? tokens.ui.ink,
                }}
              />
              <EventIcon event={item.event} localPlayerId={props.localPlayerId ?? 0} />
            </>
          );
          const className = `${styles.item} ${item.important ? styles.important : ''}`;
          const text = label(item.event, props.localPlayerId ?? 0);

          return item.hex === null || item.hex === undefined ? (
            <div className={className} key={item.id} title={text} aria-label={text} role="img">
              {content}
            </div>
          ) : (
            <button
              className={className}
              key={item.id}
              type="button"
              title={text}
              aria-label={text}
              onClick={() => props.onFocus(item)}
            >
              {content}
            </button>
          );
        })(),
      )}
    </div>
  );
}
