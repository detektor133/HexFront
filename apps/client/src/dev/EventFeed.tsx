import {
  IconArrowBackUp,
  IconCheck,
  IconBuildingCastle,
  IconChevronLeft,
  IconChevronRight,
  IconFlag,
  IconHammer,
  IconHeartHandshake,
  IconInfoCircle,
  IconShield,
  IconLink,
  IconPeace,
  IconUsers,
  IconLinkOff,
  IconSkull,
  IconSwords,
  IconTrophy,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import type { Command, GameEvent, PlayerView, TreatyKind } from '@hexfront/sim';

import { offerKey } from './DiplomacyBlock.tsx';
import styles from './EventFeed.module.css';
import { VoteCard } from './VoteCard.tsx';
import type { EventFeedItem } from './event-feed.ts';
import { FEED_SLOTS, visibleEvents } from './event-feed.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

const VOTE_SHORT = {
  join: 'vote.joinShort',
  peace: 'vote.peaceShort',
  kick: 'vote.kickShort',
} as const;

/** Вид записи-запроса в ленте. */
export type FeedKind = 'peace' | 'pact' | 'defense' | 'alliance' | 'aid' | 'vote';

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
  if (event.t === 'playerEliminated') return <IconFlag size={18} aria-hidden />;
  if (event.t === 'matchWon') return <IconTrophy size={18} aria-hidden />;
  return <IconInfoCircle size={18} aria-hidden />;
}

/** Строка ленты: значок, подпись и кнопки ответа — всё в одной плашке. */
function Row(props: {
  readonly id: string;
  readonly icon: React.ReactNode;
  readonly text: string;
  readonly accent?: string | undefined;
  readonly important?: boolean;
  readonly open?: boolean;
  readonly offer?: boolean;
  readonly role?: string;
  /** Вид запроса: цветная метка перед текстом, чтобы мир, пакт и альянс не путались. */
  readonly kind?: FeedKind;
  /** Запись только что появилась: въезжает и вспыхивает один раз; при раскрытии ленты не повторяется. */
  readonly fresh?: boolean;
  /** Короткая приписка справа от текста (ход голосования). */
  readonly note?: string;
  /** Нажатие по значку и подписи; без него строка не кнопка. */
  readonly onMain?: (() => void) | undefined;
  readonly actions?: React.ReactNode;
}): React.JSX.Element {
  const classes = [
    styles.item,
    props.important ? styles.important : '',
    props.open ? styles.open : '',
    props.offer ? styles.offer : '',
  ].join(' ');
  const slotClass = `${styles.slot} ${props.fresh ? styles.fresh : ''}`;
  const body = (
    <>
      <span className={styles.icon}>{props.icon}</span>
      {props.kind && (
        <span className={styles.tag} data-kind={props.kind}>
          {t(`feed.kind.${props.kind}` as MessageKey)}
        </span>
      )}
      <span className={styles.name}>{props.text}</span>
      {props.note && <span className={styles.note}>{props.note}</span>}
    </>
  );
  return (
    <div className={slotClass}>
      <div
        className={classes}
        style={props.accent ? { borderRightColor: props.accent } : undefined}
        role={props.role}
      >
        {props.onMain ? (
          <button
            type="button"
            className={styles.main}
            aria-label={props.text}
            onClick={props.onMain}
          >
            {body}
          </button>
        ) : (
          <span className={styles.main} aria-label={props.text} role="img">
            {body}
          </span>
        )}
        {props.actions}
      </div>
    </div>
  );
}

/** Значок вида договора: у мира, пакта, оборонительного пакта и альянса он свой. */
function OfferIcon(props: { readonly kind: TreatyKind }) {
  if (props.kind === 'peace') return <IconPeace size={18} aria-hidden />;
  if (props.kind === 'pact') return <IconHeartHandshake size={18} aria-hidden />;
  if (props.kind === 'defense') return <IconShield size={18} aria-hidden />;
  return <IconLink size={18} aria-hidden />;
}

/** Кнопки «да» и «нет» в строке ленты. */
function Answer(props: { readonly onYes: () => void; readonly onNo: () => void }) {
  return (
    <>
      <IconButton
        className={`${styles.answer} ${styles.accept}`}
        label={t('diplomacy.accept')}
        onClick={props.onYes}
      >
        <IconCheck size={16} aria-hidden="true" />
      </IconButton>
      <IconButton className={styles.answer} label={t('diplomacy.decline')} onClick={props.onNo}>
        <IconX size={16} aria-hidden="true" />
      </IconButton>
    </>
  );
}

const ownerColor = (playerId: number): string =>
  tokens.players.palette[playerId]?.line ?? tokens.ui.ink;

type Offer = NonNullable<PlayerView['diplomacy']>['incoming'][number];

/** Записи ленты: события и входящие предложения дипломатии (последние висят, пока не отвечены). */
export function feedRows(
  items: readonly EventFeedItem[],
  offers: readonly Offer[],
  graceLeftS?: number,
  signals = 0,
  hold = false,
  capitulating = 0,
  asks = 0,
): number {
  const grace = graceLeftS === undefined ? 0 : 1;
  const total =
    items.filter((item) => item.event.t !== 'treatyOffered').length +
    offers.length +
    grace +
    signals +
    capitulating +
    asks +
    (hold ? 1 : 0);
  // Лишнее сворачивается в строку «+K»: она тоже занимает место.
  return Math.min(FEED_SLOTS, total) + (total > FEED_SLOTS ? 1 : 0);
}

function diplomacyOther(event: GameEvent, me: number): number | null {
  if (event.t === 'playerEliminated') return event.playerId;
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
  /** Сигналы границы, которых не видно на экране: строка в ленте, тап ведёт к границе. */
  readonly signals?: readonly { readonly other: number; readonly hex: number }[];
  readonly onSignal?: (hex: number) => void;
  /** Игрок, который держит нужную долю городов: до победы (или поражения) остаётся секунд. */
  readonly hold?: { readonly player: number; readonly seconds: number } | null | undefined;
  /** Игроки без городов: до капитуляции остаётся секунд (враг скоро выбывает). */
  readonly capitulating?: readonly { readonly player: number; readonly seconds: number }[];
  /** Запросы помощи (оборонительный пакт) и голосования альянса, на которые игрок ещё не ответил. */
  readonly aidCalls?: readonly { readonly victim: number; readonly aggressor: number }[];
  readonly votes?: NonNullable<PlayerView['diplomacy']>['votes'];
  readonly nameOf?: (playerId: number) => string;
  readonly send?: (cmd: Command) => void;
  /** Секунд до выбывания при отсутствии городов; нет — города есть. */
  readonly graceLeftS?: number | undefined;
  readonly localPlayerId?: number;
  readonly now: number;
  readonly onFocus: (item: EventFeedItem) => void;
  readonly style?: React.CSSProperties | undefined;
  /** Телефон: нажатие в любом другом месте убирает записи ленты (новые появляются снова). */
  readonly compact?: boolean;
}): React.JSX.Element | null {
  const [now, setNow] = useState<number>(props.now);
  // Вся лента спрятана за вкладку у края; раскрывает её только нажатие на вкладку.
  const [hidden, setHidden] = useState(false);
  // Какие записи уже показывались: у знакомых при раскрытии ленты анимации нет.
  const seen = useRef<ReadonlySet<string>>(new Set());
  const isFresh = (key: string): boolean => !seen.current.has(key);
  const [voteOpen, setVoteOpen] = useState<number | null>(null);
  // Убранные нажатием в другом месте: до появления новой записи с другим ключом.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setNow(props.now);
  }, [props.now]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  // Предложения показываются из состояния (с кнопками ответа), а не одноразовой записью.
  const items = visibleEvents(props.items, now).filter(
    (item) => item.event.t !== 'treatyOffered' && !dismissed.has(`event:${item.id}`),
  );
  const offers = props.offers ?? [];
  const grace = dismissed.has('grace') ? undefined : props.graceLeftS;
  const signals = (props.signals ?? []).filter(({ other }) => !dismissed.has(`signal:${other}`));
  const hold = dismissed.has('hold') ? null : (props.hold ?? null);
  // Ключи строк, которые можно убрать нажатием в стороне; предложения договоров остаются.
  const dismissible = useRef<string[]>([]);
  dismissible.current = [
    ...items.map((item) => `event:${item.id}`),
    ...signals.map(({ other }) => `signal:${other}`),
    ...(grace === undefined ? [] : ['grace']),
    ...(hold === null ? [] : ['hold']),
  ];
  const compact = props.compact ?? false;
  useEffect(() => {
    if (!compact) return;
    const onDown = (event: PointerEvent): void => {
      if ((event.target as Element | null)?.closest('[data-feed]')) return;
      if (dismissible.current.length === 0) return;
      setDismissed((current) => new Set([...current, ...dismissible.current]));
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [compact]);
  const empty =
    items.length === 0 &&
    offers.length === 0 &&
    signals.length === 0 &&
    grace === undefined &&
    hold === null &&
    (props.capitulating ?? []).length === 0 &&
    (props.aidCalls ?? []).length === 0 &&
    (props.votes ?? []).length === 0;
  const nameOf = props.nameOf ?? ((id: number) => String(id + 1));
  const me = props.localPlayerId ?? 0;
  // Места ленты — строго FEED_SLOTS: сверху то, что ждёт ответа или идёт по таймеру, ниже сигналы
  // границы и события, новые раньше старых. Не поместившееся уходит в счётчик «+K».
  const specs: { readonly key: string; readonly node: React.JSX.Element }[] = [];
  for (const offer of offers) {
    const key = `offer:${offer.from}`;
    specs.push({
      key,
      node: (
        <Row
          key={key}
          id={key}
          fresh={isFresh(key)}
          icon={<OfferIcon kind={offer.kind} />}
          text={`${t(offerKey(offer.kind))}: ${nameOf(offer.from)}`}
          kind={offer.kind}
          accent={ownerColor(offer.from)}
          offer
          role="status"
          actions={
            <>
              <IconButton
                className={`${styles.answer} ${styles.accept}`}
                label={t('diplomacy.accept')}
                onClick={() => props.send?.({ t: 'answerTreaty', from: offer.from, accept: true })}
              >
                <IconCheck size={16} aria-hidden="true" />
              </IconButton>
              <IconButton
                className={styles.answer}
                label={t('diplomacy.decline')}
                onClick={() => props.send?.({ t: 'answerTreaty', from: offer.from, accept: false })}
              >
                <IconX size={16} aria-hidden="true" />
              </IconButton>
            </>
          }
        />
      ),
    });
  }
  for (const call of props.aidCalls ?? []) {
    const key = `aid:${call.aggressor}`;
    specs.push({
      key,
      node: (
        <Row
          key={key}
          id={key}
          fresh={isFresh(key)}
          icon={<IconShield size={18} aria-hidden />}
          text={`${nameOf(call.victim)} ${t('feed.aidAsk')} ${nameOf(call.aggressor)}`}
          kind="aid"
          accent={ownerColor(call.victim)}
          offer
          role="alert"
          actions={
            <Answer
              onYes={() => props.send?.({ t: 'answerAid', aggressor: call.aggressor, join: true })}
              onNo={() => props.send?.({ t: 'answerAid', aggressor: call.aggressor, join: false })}
            />
          }
        />
      ),
    });
  }
  // Голосования: сначала те, где я ещё не ответил, потом идущие, потом законченные (итог виден 30 с).
  const waiting = (v: { canVote: boolean; mine: string | null; result: string | null }): boolean =>
    v.canVote && v.mine === null && v.result === null;
  const votes = [...(props.votes ?? [])].sort(
    (x, y) =>
      Number(!waiting(x)) - Number(!waiting(y)) ||
      Number(x.result !== null) - Number(y.result !== null) ||
      x.id - y.id,
  );
  for (const vote of votes) {
    const key = `vote:${vote.id}`;
    specs.push({
      key,
      node: (
        <Row
          key={key}
          id={key}
          fresh={isFresh(key)}
          icon={<IconUsers size={18} aria-hidden />}
          kind="vote"
          text={`${t(VOTE_SHORT[vote.kind])}: ${nameOf(vote.a)} · ${nameOf(vote.b)}`}
          note={
            vote.result === null
              ? `${vote.yes.length}/${vote.voters.length}`
              : t(vote.result === 'passed' ? 'vote.passed' : 'vote.failed')
          }
          offer={waiting(vote)}
          role="status"
          onMain={() => setVoteOpen(vote.id)}
        />
      ),
    });
  }
  if (hold !== null) {
    specs.push({
      key: 'hold',
      node: (
        <Row
          key="hold"
          id="hold"
          fresh={isFresh('hold')}
          icon={<IconTrophy size={18} aria-hidden />}
          text={`${nameOf(hold.player)} ${t('match.holdsCities')} · 00:${String(hold.seconds).padStart(2, '0')}`}
          accent={ownerColor(hold.player)}
          important={hold.player !== me}
          open
          role="status"
        />
      ),
    });
  }
  if (grace !== undefined) {
    specs.push({
      key: 'grace',
      node: (
        <Row
          key="grace"
          id="grace"
          fresh={isFresh('grace')}
          icon={<IconBuildingCastle size={18} aria-hidden />}
          text={`${t('match.noCities')}: ${grace} ${t('match.seconds')}`}
          important
          open
          role="alert"
        />
      ),
    });
  }
  for (const { player, seconds } of props.capitulating ?? []) {
    const key = `capitulation:${player}`;
    specs.push({
      key,
      node: (
        <Row
          key={key}
          id={key}
          fresh={isFresh(key)}
          icon={<IconFlag size={18} aria-hidden />}
          text={`${nameOf(player)} ${t('match.capitulates')}: ${seconds} ${t('match.seconds')}`}
          accent={ownerColor(player)}
          open
          role="status"
        />
      ),
    });
  }
  for (const { other, hex } of signals) {
    const key = `signal:${other}`;
    specs.push({
      key,
      node: (
        <Row
          key={key}
          id={key}
          fresh={isFresh(key)}
          icon={<IconShield size={18} aria-hidden />}
          text={`${t('signal.border')}: ${nameOf(other)}`}
          accent={ownerColor(other)}
          important
          offer
          onMain={() => props.onSignal?.(hex)}
        />
      ),
    });
  }
  for (const item of [...items].reverse()) {
    const other = diplomacyOther(item.event, me);
    const text = label(item.event, me);
    const full = other === null ? text : `${text}: ${nameOf(other)}`;
    const key = `event:${item.id}`;
    specs.push({
      key,
      node: (
        <Row
          key={key}
          id={key}
          fresh={isFresh(key)}
          icon={<EventIcon event={item.event} localPlayerId={me} />}
          text={full}
          accent={item.important ? undefined : ownerColor(item.event.playerId)}
          important={item.important}
          onMain={
            item.hex === null || item.hex === undefined ? undefined : () => props.onFocus(item)
          }
        />
      ),
    });
  }
  const shown = specs.slice(0, FEED_SLOTS);
  const more = specs.length - shown.length;
  const open = !hidden;
  const HandleIcon = hidden ? IconChevronRight : IconChevronLeft;
  const pending = (props.votes ?? []).filter(waiting);
  // Новое голосование открывается карточкой само — один раз: и то, где ждут моего ответа, и то,
  // что боты уже решили (иначе быстрый ответ ботов прятал бы исход).
  const autoVote = (props.votes ?? []).find(
    (v) => isFresh(`vote:${v.id}`) && (waiting(v) || v.result !== null || v.a === me),
  )?.id;
  useEffect(() => {
    seen.current = new Set(specs.map((spec) => spec.key));
    if (autoVote !== undefined) setVoteOpen(autoVote);
  });
  const card = (props.votes ?? []).find((v) => v.id === voteOpen);
  if (empty) return null;
  return (
    <div className={styles.feed} style={props.style} aria-label={t('event.feed')} data-feed>
      <div className={styles.dock}>
        <button
          type="button"
          className={styles.handle}
          data-alert={hidden && (offers.length > 0 || pending.length > 0)}
          aria-label={t(hidden ? 'feed.show' : 'feed.hide')}
          title={t(hidden ? 'feed.show' : 'feed.hide')}
          aria-expanded={!hidden}
          onClick={() => setHidden(!hidden)}
        >
          <HandleIcon size={14} aria-hidden />
          {hidden && <span className={styles.badge}>{specs.length}</span>}
        </button>
        <div className={styles.rows} data-open={open}>
          <div className={styles.rowsInner}>
            {shown.map((spec) => spec.node)}
            {more > 0 && (
              <span className={styles.more} title={t('feed.more')} role="status">
                +{more}
              </span>
            )}
          </div>
        </div>
      </div>
      {card && (
        <VoteCard
          vote={card}
          me={me}
          nameOf={nameOf}
          colorOf={ownerColor}
          onVote={(yes) => props.send?.({ t: 'castVote', voteId: card.id, yes })}
          onClose={() => setVoteOpen(null)}
        />
      )}
    </div>
  );
}
