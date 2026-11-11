// Лобби онлайн-матча: набор людей (30 с) или приглашение друзей по ссылке, затем переход в матч.
import { useEffect, useRef, useState } from 'react';

import type { LobbyInfo, RefuseReason } from '@hexfront/protocol';

import { t, type MessageKey } from '../i18n/dict.ts';
import { navigate } from '../nav.ts';
import styles from './OnlineLobby.module.css';
import { NICKNAME_KEY } from './storage-keys.ts';
import { NetClient, realClock, webSocketTransport, type NetSession } from '../net/net-client.ts';
import { saveOnlineSession, serverUrl } from '../net/online-session.ts';

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

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="online-title">
        <h1 id="online-title" className={styles.title}>
          {t(mode === 'private' || room !== null ? 'online.privateTitle' : 'online.title')}
        </h1>
        {error !== null ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : info === null ? (
          <p className={styles.status}>{t('online.connecting')}</p>
        ) : (
          <>
            <p className={styles.count}>
              {info.humans} / {info.max}
            </p>
            <p className={styles.status}>
              {info.startsInS === null
                ? t('online.waitHost')
                : `${t('online.startsIn')} ${info.startsInS} ${t('online.sec')}`}
            </p>
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
        <button type="button" className={styles.back} onClick={() => navigate('/')}>
          {t('online.back')}
        </button>
      </section>
    </main>
  );
}
