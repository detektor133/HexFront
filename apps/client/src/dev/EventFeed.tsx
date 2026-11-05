import {
  IconArrowBackUp,
  IconCheck,
  IconBuildingCastle,
  IconFlag,
  IconHammer,
  IconHeartHandshake,
  IconInfoCircle,
  IconLink,
  IconLinkOff,
  IconSkull,
  IconSwords,
  IconTrophy,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import type { Command, GameEvent, PlayerView } from '@hexfront/sim';

import { offerKey } from './DiplomacyBlock.tsx';
import styles from './EventFeed.module.css';
import type { EventFeedItem } from './event-feed.ts';
import { visibleEvents } from './event-feed.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

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
  if (event.t === 'constructionDone') return <IconHammer size={18} aria-hidden />;
  if (event.t === 'matchWon') return <IconTrophy size={18} aria-hidden />;
  return <IconInfoCircle size={18} aria-hidden />;
}

const ownerColor = (playerId: number): string =>
  tokens.players.palette[playerId]?.line ?? tokens.ui.ink;

type Offer = NonNullable<PlayerView['diplomacy']>['incoming'][number];

/** Записи ленты: события и входящие предложения дипломатии (последние висят, пока не отвечены). */
export function feedRows(
  items: readonly EventFeedItem[],
  offers: readonly Offer[],
  graceLeftS?: number,
): number {
  const grace = graceLeftS === undefined ? 0 : 1;
  return Math.min(
    4,
    items.filter((item) => item.event.t !== 'treatyOffered').length + offers.length + grace,
  );
}

function diplomacyOther(event: GameEvent, me: number): number | null {
  if (
    event.t === 'warDeclared' ||
    event.t === 'treatyMade' ||
    event.t === 'treatyBroken' ||
    event.t === 'treatyOffered'
  ) {
    return event.playerId === me ? event.targetId : event.playerId;
  }
  return null;
}

export function EventFeed(props: {
  readonly items: readonly EventFeedItem[];
  readonly offers?: readonly Offer[];
  readonly nameOf?: (playerId: number) => string;
  readonly send?: (cmd: Command) => void;
  /** Секунд до выбывания при отсутствии городов; нет — города есть. */
  readonly graceLeftS?: number | undefined;
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
  // Предложения показываются из состояния (с кнопками ответа), а не одноразовой записью.
  const items = visibleEvents(props.items, now).filter((item) => item.event.t !== 'treatyOffered');
  const offers = props.offers ?? [];
  const grace = props.graceLeftS;
  if (items.length === 0 && offers.length === 0 && grace === undefined) return null;
  const nameOf = props.nameOf ?? ((id: number) => String(id + 1));
  const me = props.localPlayerId ?? 0;
  return (
    <div className={styles.feed} style={props.style} aria-label={t('event.feed')}>
      {grace !== undefined && (
        <div className={styles.slot}>
          <div className={`${styles.item} ${styles.important}`} role="alert">
            <IconBuildingCastle size={18} aria-hidden className={styles.icon} />
            <span
              className={styles.name}
            >{`${t('match.noCities')}: ${grace} ${t('match.seconds')}`}</span>
          </div>
        </div>
      )}
      {offers.map((offer) => (
        <div className={styles.slot} key={`offer:${offer.from}`}>
          <div
            className={`${styles.item} ${styles.offer}`}
            style={{ borderRightColor: ownerColor(offer.from) }}
            role="status"
          >
            {offer.kind === 'pact' ? (
              <IconHeartHandshake size={18} aria-hidden className={styles.icon} />
            ) : (
              <IconLink size={18} aria-hidden className={styles.icon} />
            )}
            <span
              className={styles.name}
            >{`${t(offerKey(offer.kind))}: ${nameOf(offer.from)}`}</span>
            <IconButton
              className={styles.answer}
              label={t('diplomacy.accept')}
              onClick={() => props.send?.({ t: 'answerTreaty', from: offer.from, accept: true })}
            >
              <IconCheck size={18} aria-hidden="true" />
            </IconButton>
            <IconButton
              className={styles.answer}
              label={t('diplomacy.decline')}
              onClick={() => props.send?.({ t: 'answerTreaty', from: offer.from, accept: false })}
            >
              <IconX size={18} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      ))}
      {items.map((item) =>
        (() => {
          const other = diplomacyOther(item.event, me);
          const text = label(item.event, me);
          const full = other === null ? text : `${text}: ${nameOf(other)}`;
          const content = (
            <>
              <span className={styles.icon}>
                <EventIcon event={item.event} localPlayerId={me} />
              </span>
              <span className={styles.name}>{full}</span>
            </>
          );
          const className = `${styles.item} ${item.important ? styles.important : ''}`;
          const style = { borderRightColor: ownerColor(item.event.playerId) };

          return (
            <div className={styles.slot} key={item.id}>
              {item.hex === null || item.hex === undefined ? (
                <div
                  className={className}
                  style={item.important ? undefined : style}
                  aria-label={full}
                  role="img"
                >
                  {content}
                </div>
              ) : (
                <button
                  className={className}
                  style={item.important ? undefined : style}
                  type="button"
                  aria-label={full}
                  onClick={() => props.onFocus(item)}
                >
                  {content}
                </button>
              )}
            </div>
          );
        })(),
      )}
    </div>
  );
}
