// Лобби онлайн-матча внутри главного меню: поверх живой карты, окном-«телевизором». Набор людей
// (30 с) или приглашение друзей по ссылке, затем переход в матч.
import { IconArrowLeft, IconCrown } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import { LOBBY_LEVELS, type LobbyInfo, type RefuseReason } from '@hexfront/protocol';

import { t, type MessageKey } from '../i18n/dict.ts';
import { navigate } from '../nav.ts';
import { MapPicker } from './MapPicker.tsx';
import { Chips } from './MenuParts.tsx';
import { Stepper } from './Stepper.tsx';
import styles from './lobby.module.css';
import {
  GEN_SIZES,
  GEN_SIZE_DEFAULT,
  maxPlayersOf,
  randomGenSeed,
  type MenuMapId,
} from './menu-config.ts';
import ui from './menu-ui.module.css';
import { NetClient, realClock, webSocketTransport, type NetSession } from '../net/net-client.ts';
import {
  clearOnlineSession,
  loadOnlineSession,
  saveOnlineSession,
  serverUrl,
} from '../net/online-session.ts';
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
  /** Вернуться на своё место по токену вкладки: в идущий матч или в лобби после «Ещё раз». */
  readonly resume?: boolean;
}

/** Разбирает адрес вида `/online?mode=private` или `/online?room=КОД`. */
export function lobbyFromUrl(url: string): LobbyRequest | null {
  const target = new URL(url, window.location.origin);
  if (target.pathname !== '/online') return null;
  return {
    mode: target.searchParams.get('mode') === 'private' ? 'private' : 'open',
    room: target.searchParams.get('room'),
    ...(target.searchParams.get('spectate') === '1' ? { spectate: true } : {}),
    ...(target.searchParams.get('resume') === '1' ? { resume: true } : {}),
  };
}

function refusalText(reason: RefuseReason): string {
  return t(`online.refused.${reason}` as MessageKey);
}

function matchLink(session: NetSession): string {
  const params = new URLSearchParams({
    map: session.map,
    seed: String(session.seed),
    players: String(session.players),
    size: String(session.genSpawns),
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

/** Список людей в комнате: цвет, ник, хозяин, готовность; хозяин может передать комнату. */
function Roster(props: {
  readonly seats: LobbyInfo['seats'];
  readonly me: number;
  readonly isHost: boolean;
  readonly onTransfer: (id: number) => void;
}): React.JSX.Element {
  const palette = tokens.players.palette;
  return (
    <ul className={styles.roster}>
      {props.seats.map((seat) => (
        <li key={seat.id} className={styles.person}>
          <span
            className={styles.dot}
            style={{ backgroundColor: palette[seat.id % palette.length]?.line }}
          />
          <span className={styles.nick}>
            {seat.nick}
            {seat.id === props.me && <small>{' · ' + t('vote.you')}</small>}
          </span>
          {seat.host ? (
            <span className={styles.tag}>{t('lobby.host')}</span>
          ) : (
            <span className={`${styles.tag} ${seat.ready ? styles.ready : ''}`}>
              {seat.ready ? t('lobby.ready') : t('lobby.notReady')}
            </span>
          )}
          {props.isHost && !seat.host && (
            <button
              type="button"
              className={styles.crown}
              title={t('lobby.makeHost')}
              aria-label={`${t('lobby.makeHost')}: ${seat.nick}`}
              onClick={() => props.onTransfer(seat.id)}
            >
              <IconCrown size={18} aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function LobbyPanel(props: {
  readonly request: LobbyRequest;
  readonly nick: string;
  readonly onClose: () => void;
  /** Карта и зерно комнаты: фон меню показывает её. */
  readonly onRoomMap?: (map: MenuMapId, seed: number, size: number) => void;
  readonly className: string;
}): React.JSX.Element {
  const { mode, room } = props.request;
  const spectate = props.request.spectate === true;
  const resume = props.request.resume === true;
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
    const saved = resume ? loadOnlineSession() : null;
    const client = new NetClient({
      connect: webSocketTransport(url),
      clock: realClock,
      nick,
      mode,
      ...(room === null ? {} : { room }),
      ...(spectate ? { spectate: true } : {}),
      ...(resume && saved !== null ? { token: saved.token } : {}),
      handlers: {
        onSession: setSession,
        onLobby: (lobby, host) => {
          setInfo(lobby);
          setIsHost(host);
        },
        onRefused: (reason) => {
          if (reason === 'noRoom') clearOnlineSession();
          setError(refusalText(reason));
        },
        onStart: () => {
          const current = client.session;
          if (current === null) return;
          handedOver = true;
          saveOnlineSession({
            token: current.token,
            server: url,
            nick,
            ...(mode === 'private' || room !== null ? { friends: true } : {}),
          });
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
  }, [mode, room, spectate, resume, nick, attempt]);

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
  const { onRoomMap } = props;
  const roomMap = info?.map;
  const roomSeed = session?.seed;
  const roomSize = session?.genSpawns;
  useEffect(() => {
    if (roomMap !== undefined && roomSeed !== undefined && roomSize !== undefined) {
      onRoomMap?.(roomMap, roomSeed, roomSize);
    }
  }, [roomMap, roomSeed, roomSize, onRoomMap]);
  const mySeat = (info?.seats ?? []).find((seat) => seat.id === session?.playerId);

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
        <div className={styles.cols}>
          <div className={styles.col}>
            <div className={styles.top}>
              <Clock seconds={info.startsInS} />
              <div className={styles.topText}>
                <p className={styles.status}>
                  {info.startsInS === null ? t('online.waitHost') : t('online.lookingFor')}
                </p>
                <p className={styles.count}>
                  <b>{`${info.humans} ${t('online.people')}`}</b>
                  <span>{` · ${Math.max(0, max - info.humans)} ${t('online.botsFill')}`}</span>
                </p>
                <Seats humans={info.humans} max={max} />
              </div>
            </div>
            {invite !== null && session !== null && (
              <div className={styles.invite}>
                <b className={styles.inviteCode} aria-label={t('online.roomCode')}>
                  {session.room.toUpperCase()}
                </b>
                <button type="button" className={styles.inviteCopy} onClick={copy}>
                  {copied ? t('online.copied') : t('online.copyLink')}
                </button>
              </div>
            )}
            {mode === 'private' && session !== null && (
              <Roster
                seats={info.seats}
                me={session.playerId}
                isHost={isHost}
                onTransfer={(id) => clientRef.current?.transfer(id)}
              />
            )}
            {mode === 'private' && (
              <>
                {isHost ? (
                  <button
                    type="button"
                    className={`${ui.action} ${ui.primary}`}
                    onClick={() => clientRef.current?.startMatch()}
                  >
                    {`${t('online.start')} · ${info.seats.filter((s) => s.ready || s.host).length}/${info.humans} ${t('lobby.readyCount')}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`${ui.action} ${mySeat?.ready === true ? '' : ui.primary}`}
                    aria-pressed={mySeat?.ready === true}
                    onClick={() => clientRef.current?.setReady(mySeat?.ready !== true)}
                  >
                    {mySeat?.ready === true ? t('lobby.notReady') : t('lobby.ready')}
                  </button>
                )}
              </>
            )}
          </div>
          {mode === 'private' && (
            <div className={styles.col}>
              <MapPicker
                map={info.map}
                editable={isHost}
                onMap={(next) => clientRef.current?.configure({ map: next })}
                onOtherMap={() =>
                  clientRef.current?.configure({
                    seed: randomGenSeed(session?.seed),
                  })
                }
                genSize={session?.genSpawns ?? GEN_SIZE_DEFAULT}
              />
              {isHost && (
                <>
                  {info.map === 'gen' && (
                    <Chips
                      dense
                      label={t('menu.genSize')}
                      options={GEN_SIZES.map((n) => ({
                        id: String(n),
                        text: t(`menu.genSize.${n}` as MessageKey),
                      }))}
                      value={String(session?.genSpawns ?? GEN_SIZE_DEFAULT)}
                      onPick={(id) => {
                        const genSpawns = GEN_SIZES.find((n) => String(n) === id);
                        if (genSpawns !== undefined) clientRef.current?.configure({ genSpawns });
                      }}
                    />
                  )}
                  <div className={`${ui.group} ${ui.dense}`}>
                    <div className={ui.groupLabel}>{t('menu.botsCount')}</div>
                    <Stepper
                      label={t('menu.botsCount')}
                      min={0}
                      max={Math.max(0, maxPlayersOf(info.map, session?.genSpawns) - info.humans)}
                      value={Math.max(0, info.max - info.humans)}
                      onChange={(bots) =>
                        clientRef.current?.configure({ players: info.humans + bots })
                      }
                    />
                  </div>
                  <Chips
                    dense
                    label={t('menu.difficulty')}
                    options={LOBBY_LEVELS.map((l) => ({
                      id: l,
                      text: t(`menu.difficulty.${l}` as MessageKey),
                    }))}
                    value={info.level}
                    onPick={(level) => clientRef.current?.configure({ level })}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
