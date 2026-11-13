// Лобби онлайн-матча внутри главного меню: поверх живой карты, окном-«телевизором». Набор людей
// (30 с) или приглашение друзей по ссылке, затем переход в матч.
import { IconArrowLeft, IconDice } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import {
  LOBBY_LEVELS,
  QUICK_MATCH_SEEDS,
  type LobbyInfo,
  type RefuseReason,
} from '@hexfront/protocol';

import { t, type MessageKey } from '../i18n/dict.ts';
import { navigate } from '../nav.ts';
import { Chips } from './MenuParts.tsx';
import styles from './lobby.module.css';
import ui from './menu-ui.module.css';
import { NetClient, realClock, webSocketTransport, type NetSession } from '../net/net-client.ts';
import { saveOnlineSession, serverUrl } from '../net/online-session.ts';
import { tokens } from '../theme/tokens.ts';

/** Сколько секунд длится сбор: кольцо отсчёта пустеет за это время. */
const GATHER_SECONDS = 30;
const SEATS_FALLBACK = 30;

export interface LobbyRequest {
  readonly mode: 'open' | 'private';
  /** Код комнаты по приглашению. */
  readonly room: string | null;
  /** Смотреть идущий матч этой комнаты, не занимая места. */
  readonly spectate?: boolean;
}

/** Разбирает адрес вида `/online?mode=private` или `/online?room=КОД`. */
export function lobbyFromUrl(url: string): LobbyRequest | null {
  const target = new URL(url, window.location.origin);
  if (target.pathname !== '/online') return null;
  return {
    mode: target.searchParams.get('mode') === 'private' ? 'private' : 'open',
    room: target.searchParams.get('room'),
    ...(target.searchParams.get('spectate') === '1' ? { spectate: true } : {}),
  };
}

/** Следующая готовая карта по кругу: у клиента для каждого сида есть файл карты. */
function nextSeed(current: number): number {
  const at = QUICK_MATCH_SEEDS.findIndex((seed) => seed === current);
  return QUICK_MATCH_SEEDS[(at + 1) % QUICK_MATCH_SEEDS.length] ?? QUICK_MATCH_SEEDS[0];
}

function refusalText(reason: RefuseReason): string {
  return t(`online.refused.${reason}` as MessageKey);
}

function matchLink(session: NetSession): string {
  const params = new URLSearchParams({
    map: session.map,
    seed: String(session.seed),
    players: String(session.players),
    online: '1',
    ...(session.spectator ? { spectate: '1' } : {}),
  });
  return `/match?${params.toString()}`;
}

/** Вращающийся шестиугольник: идёт подключение. */
function Spinner(): React.JSX.Element {
  return (
    <svg className={styles.spinner} viewBox="0 0 48 48" aria-hidden="true">
      <polygon
        points="44,24 34,41.3 14,41.3 4,24 14,6.7 34,6.7"
        pathLength={100}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Кольцо отсчёта: число секунд до старта в центре, дуга сгорает по мере приближения старта. */
function Clock(props: { readonly seconds: number | null }): React.JSX.Element {
  const fraction =
    props.seconds === null ? 1 : Math.max(0, Math.min(1, props.seconds / GATHER_SECONDS));
  return (
    <div className={styles.clock} role="timer" aria-live="polite">
      <svg viewBox="0 0 100 100" className={styles.ring} aria-hidden="true">
        <circle cx="50" cy="50" r="44" className={styles.track} />
        <circle
          cx="50"
          cy="50"
          r="44"
          pathLength={100}
          className={styles.arc}
          style={{ strokeDasharray: `${fraction * 100} 100` }}
        />
      </svg>
      <div className={styles.clockBody}>
        {props.seconds === null ? (
          <Spinner />
        ) : (
          <>
            <span key={props.seconds} className={styles.number}>
              {props.seconds}
            </span>
            <small>{t('online.untilStart')}</small>
          </>
        )}
      </div>
    </div>
  );
}

/** Места: занятые людьми окрашены по порядку, свободные займут боты. */
function Seats(props: { readonly humans: number; readonly max: number }): React.JSX.Element {
  const palette = tokens.players.palette;
  return (
    <div className={styles.seats} aria-hidden="true">
      {Array.from({ length: props.max }, (_, index) => {
        const taken = index < props.humans;
        const line = palette[index % palette.length]?.line;
        return (
          <span
            key={index}
            className={`${styles.seat} ${taken ? styles.taken : ''}`}
            style={taken && line !== undefined ? { backgroundColor: line } : undefined}
          />
        );
      })}
    </div>
  );
}

export function LobbyPanel(props: {
  readonly request: LobbyRequest;
  readonly nick: string;
  readonly onClose: () => void;
  readonly className: string;
}): React.JSX.Element {
  const { mode, room } = props.request;
  const spectate = props.request.spectate === true;
  const [info, setInfo] = useState<LobbyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<NetSession | null>(null);
  const [copied, setCopied] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const clientRef = useRef<NetClient | null>(null);
  const nick = props.nick === '' ? t('menu.defaultNick') : props.nick;

  useEffect(() => {
    setInfo(null);
    setError(null);
    setSession(null);
    const url = serverUrl(window.location.search);
    if (url === null) {
      setError(t('online.noServer'));
      return;
    }
    let handedOver = false;
    const client = new NetClient({
      connect: webSocketTransport(url),
      clock: realClock,
      nick,
      mode,
      ...(room === null ? {} : { room }),
      ...(spectate ? { spectate: true } : {}),
      handlers: {
        onSession: setSession,
        onLobby: (lobby, host) => {
          setInfo(lobby);
          setIsHost(host);
        },
        onRefused: (reason) => setError(refusalText(reason)),
        onStart: () => {
          const current = client.session;
          if (current === null) return;
          handedOver = true;
          saveOnlineSession({ token: current.token, server: url, nick });
          client.stop();
          navigate(matchLink(current));
        },
      },
    });
    clientRef.current = client;
    client.start();
    return () => {
      // Закрыли окно, не дождавшись матча: освобождаем место.
      if (!handedOver) client.stop();
    };
  }, [mode, room, spectate, nick, attempt]);

  const invite =
    session !== null && mode === 'private'
      ? `${window.location.origin}/online?room=${session.room}`
      : null;
  const copy = (): void => {
    if (invite === null) return;
    void navigator.clipboard.writeText(invite).then(() => setCopied(true));
  };
  const friends = mode === 'private' || room !== null;
  const title = t(
    spectate ? 'online.spectateTitle' : friends ? 'online.privateTitle' : 'online.searching',
  );
  const max = info?.max ?? SEATS_FALLBACK;

  return (
    <div
      className={`${ui.panel} ${styles.lobby} ${props.className}`}
      role="group"
      aria-label={title}
    >
      <div className={ui.panelHead}>
        <button
          type="button"
          className={ui.back}
          aria-label={t('online.cancel')}
          onClick={props.onClose}
        >
          <IconArrowLeft size={22} aria-hidden="true" />
        </button>
        <h2 className={ui.panelTitle}>{title}</h2>
      </div>

      {error !== null ? (
        <>
          <p className={styles.error} role="alert">
            {error}
          </p>
          <button
            type="button"
            className={`${ui.action} ${ui.primary}`}
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t('online.retry')}
          </button>
        </>
      ) : info === null ? (
        <div className={styles.connecting}>
          <Spinner />
          <span>{t('online.connecting')}</span>
        </div>
      ) : (
        <>
          <Clock seconds={info.startsInS} />
          <p className={styles.status}>
            {info.startsInS === null ? t('online.waitHost') : t('online.lookingFor')}
          </p>
          <Seats humans={info.humans} max={max} />
          <p className={styles.count}>
            <b>{`${info.humans} ${t('online.people')}`}</b>
            <span>{` · ${Math.max(0, max - info.humans)} ${t('online.botsFill')}`}</span>
          </p>
          {invite !== null && session !== null && (
            <div className={styles.invite}>
              <span className={styles.inviteLabel}>{t('online.roomCode')}</span>
              <b className={styles.inviteCode} aria-label={t('online.roomCode')}>
                {session.room.toUpperCase()}
              </b>
              <button type="button" className={`${ui.action} ${styles.inviteCopy}`} onClick={copy}>
                {copied ? t('online.copied') : t('online.copyLink')}
              </button>
            </div>
          )}
          {isHost && mode === 'private' && (
            <>
              <Chips
                label={t('menu.difficulty')}
                options={LOBBY_LEVELS.map((l) => ({
                  id: l,
                  text: t(`menu.difficulty.${l}` as MessageKey),
                }))}
                value={info.level}
                onPick={(level) => clientRef.current?.configure({ level })}
              />
              <div className={ui.group}>
                <div className={ui.groupLabel}>
                  {t('lobby.map')}
                  <span>{`${QUICK_MATCH_SEEDS.indexOf(info.seed as never) + 1} / ${QUICK_MATCH_SEEDS.length}`}</span>
                </div>
                <button
                  type="button"
                  className={ui.action}
                  onClick={() => clientRef.current?.configure({ seed: nextSeed(info.seed) })}
                >
                  <IconDice size={20} aria-hidden="true" />
                  {t('lobby.nextMap')}
                </button>
              </div>
            </>
          )}
          {isHost && mode === 'private' && (
            <button
              type="button"
              className={`${ui.action} ${ui.primary}`}
              onClick={() => clientRef.current?.startMatch()}
            >
              {t('online.start')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
