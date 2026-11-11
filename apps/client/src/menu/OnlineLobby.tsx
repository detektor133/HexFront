// Лобби онлайн-матча: набор людей (30 с) или приглашение друзей по ссылке, затем переход в матч.
import { useEffect, useRef, useState } from 'react';

import type { LobbyInfo, RefuseReason } from '@hexfront/protocol';

import { t, type MessageKey } from '../i18n/dict.ts';
import { navigate } from '../nav.ts';
import styles from './OnlineLobby.module.css';
import hex from './hex.module.css';
import { COLOR_KEY, NICKNAME_KEY } from './storage-keys.ts';
import { useMenuBackground } from './use-menu-background.ts';
import { NetClient, realClock, webSocketTransport, type NetSession } from '../net/net-client.ts';
import { saveOnlineSession, serverUrl } from '../net/online-session.ts';
import { tokens } from '../theme/tokens.ts';

/** Сколько мест в ряду сот на экране лобби. */
const SEATS_PER_ROW = 6;

function refusalText(reason: RefuseReason): string {
  return t(`online.refused.${reason}` as MessageKey);
}

function matchLink(session: NetSession): string {
  const params = new URLSearchParams({
    map: session.map,
    seed: String(session.seed),
    players: String(session.players),
    online: '1',
  });
  return `/match?${params.toString()}`;
}

/** Экран ожидания матча. Параметры адреса: `mode=private` — создать комнату, `room=КОД` — войти по приглашению. */
export function OnlineLobby({ search }: { readonly search: string }): React.JSX.Element {
  const params = new URLSearchParams(search);
  const room = params.get('room');
  const mode = params.get('mode') === 'private' ? 'private' : 'open';
  const [info, setInfo] = useState<LobbyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<NetSession | null>(null);
  const [copied, setCopied] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const clientRef = useRef<NetClient | null>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const [color] = useState<string>(() => localStorage.getItem(COLOR_KEY) ?? 'teal');
  const colorLine =
    tokens.players.palette.find((p) => p.id === color)?.line ?? 'var(--selection-color)';
  useMenuBackground(backgroundRef, color);

  useEffect(() => {
    const url = serverUrl(search);
    if (url === null) {
      setError(t('online.noServer'));
      return;
    }
    const nick = localStorage.getItem(NICKNAME_KEY) ?? t('observer.player');
    let handedOver = false;
    const client = new NetClient({
      connect: webSocketTransport(url),
      clock: realClock,
      nick,
      mode,
      ...(room === null ? {} : { room }),
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
      // Ушли с экрана, не дождавшись матча: освобождаем место.
      if (!handedOver) client.stop();
    };
  }, [mode, room, search]);

  const invite =
    session !== null && mode === 'private'
      ? `${window.location.origin}/online?room=${session.room}`
      : null;

  const copy = (): void => {
    if (invite === null) return;
    void navigator.clipboard.writeText(invite).then(() => setCopied(true));
  };

  const friends = mode === 'private' || room !== null;
  const seatCount = info?.max ?? 30;
  const rows = Array.from({ length: Math.ceil(seatCount / SEATS_PER_ROW) }, (_, row) =>
    Array.from(
      { length: Math.min(SEATS_PER_ROW, seatCount - row * SEATS_PER_ROW) },
      (_, column) => row * SEATS_PER_ROW + column,
    ),
  );
  const palette = tokens.players.palette;

  return (
    <main className={styles.page}>
      <div ref={backgroundRef} className={styles.background} aria-hidden="true" />
      <header className={styles.top}>
        <h1 className={styles.plate}>{t(friends ? 'online.privateTitle' : 'online.searching')}</h1>
      </header>

      <section className={styles.center} aria-label={t('online.title')}>
        {error !== null ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : (
          <>
            <div
              className={`${hex.hex} ${styles.timer} ${info === null || info.startsInS === null ? styles.waiting : ''}`}
              style={{ '--edge': colorLine } as React.CSSProperties}
              role="timer"
              aria-live="polite"
            >
              {info === null ? (
                <span>{t('online.connecting')}</span>
              ) : info.startsInS === null ? (
                <span>{t('online.waitHost')}</span>
              ) : (
                <>
                  <span>{info.startsInS}</span>
                  <small>{`${t('online.sec')} ${t('online.untilStart')}`}</small>
                </>
              )}
            </div>
            {info !== null && (
              <>
                <div className={styles.seats} aria-hidden="true">
                  {rows.map((row) => (
                    <div key={row[0]} className={styles.seatRow}>
                      {row.map((index) => {
                        const taken = index < info.humans;
                        const line = palette[index % palette.length]?.line ?? colorLine;
                        return (
                          <span
                            key={index}
                            className={`${hex.hex} ${styles.seat}`}
                            style={
                              {
                                '--edge': taken ? line : 'var(--ui-border-strong)',
                                '--fill': taken ? line : 'var(--ui-surface2)',
                              } as React.CSSProperties
                            }
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
                <p className={styles.count}>
                  {`${info.humans} ${t('online.people')}`}
                  <span>{` · ${info.max - info.humans} ${t('online.botsFill')}`}</span>
                </p>
              </>
            )}
            {invite !== null && (
              <div className={styles.invite}>
                <input
                  readOnly
                  value={invite}
                  aria-label={t('online.link')}
                  onFocus={(e) => e.target.select()}
                />
                <button type="button" onClick={copy}>
                  {copied ? t('online.copied') : t('online.copy')}
                </button>
              </div>
            )}
            {isHost && mode === 'private' && (
              <button
                type="button"
                className={styles.primary}
                onClick={() => clientRef.current?.startMatch()}
              >
                {t('online.start')}
              </button>
            )}
          </>
        )}
      </section>

      <button type="button" className={styles.back} onClick={() => navigate('/')}>
        {t(error !== null ? 'online.back' : 'online.cancel')}
      </button>
    </main>
  );
}
