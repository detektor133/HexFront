// Главное меню: фоном идёт партия ботов, внизу док режимов, над ним ник и цвет. Настройки игры и
// вопрос про обучение — окна с анимацией «телевизора».
import { IconSettings } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LobbyPanel, lobbyFromUrl, type LobbyRequest } from './LobbyPanel.tsx';
import { MenuDock } from './MenuDock.tsx';
import { NickPlate, tutorialLink, type ModeId } from './MenuParts.tsx';
import { t } from '../i18n/dict.ts';
import { isCoarsePointer } from '../input/touch-tap.ts';
import { navigate } from '../nav.ts';
import { guestNick, nickProblem, useMenuSettings } from './menu-config.ts';
import styles from './menu-ui.module.css';
import { useMenuBackground } from './use-menu-background.ts';
import { shortCount, useServerStatus } from './use-server-status.ts';
import { SettingsScreen } from '../settings/SettingsScreen.tsx';
import { fullscreenWanted, setFullscreen } from '../settings/fullscreen.ts';
import { markAsked, wasAsked } from '../tutorial/engine.ts';
import { useTvPresence } from '../ui/use-tv-presence.ts';

export function MainMenu(props: {
  readonly initialLobby?: LobbyRequest | null;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [settings, update] = useMenuSettings();
  const [mode, setMode] = useState<ModeId | null>(null);
  const [shake, setShake] = useState(0);
  const [lobby, setLobby] = useState<LobbyRequest | null>(props.initialLobby ?? null);
  // Пока лобби закрывается, показываем последнее: окно доигрывает анимацию.
  const lastLobby = useRef<LobbyRequest | null>(props.initialLobby ?? null);
  if (lobby !== null) lastLobby.current = lobby;
  const lobbyWindow = useTvPresence(lobby !== null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState<boolean>(() => !wasAsked());
  const settingsWindow = useTvPresence(settingsOpen);
  const askWindow = useTvPresence(askOpen);
  useMenuBackground(hostRef);
  const server = useServerStatus();
  const offline = server.state === 'offline';
  // Связь пропала при открытой панели «Онлайн» — панель закрывается, вернётся она сама не должна.
  useEffect(() => {
    if (offline) setMode((current) => (current === 'online' ? null : current));
  }, [offline]);

  // Переход в режим: сначала проверяем ник, на телефоне включаем полный экран (нужен жест).
  const go = useCallback(
    (url: string): void => {
      // Пустой ник заменяется именем по умолчанию, чтобы войти в игру без лишних шагов.
      if (settings.nickname.trim() === '') update({ nickname: guestNick() });
      if (nickProblem(settings.nickname)) {
        setShake((n) => n + 1);
        return;
      }
      if (isCoarsePointer() && fullscreenWanted()) void setFullscreen(true);
      // Онлайн открывается окном поверх меню, а не отдельной страницей.
      const request = lobbyFromUrl(url);
      if (request !== null) {
        setMode(null);
        setLobby(request);
        return;
      }
      navigate(url);
    },
    [settings.nickname, update],
  );

  useEffect(() => {
    if (!settingsOpen && mode === null && lobby === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (settingsOpen) setSettingsOpen(false);
      else if (lobby !== null) setLobby(null);
      else setMode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, mode, lobby]);

  const closeAsk = (): void => {
    markAsked();
    setAskOpen(false);
  };

  return (
    <main className={styles.page}>
      <div ref={hostRef} className={styles.background} aria-hidden="true" />
      <div className={styles.top}>
        <p
          className={`${styles.status} ${server.state === 'online' ? styles.live : ''} ${server.state === 'offline' ? styles.down : ''}`}
          role="status"
        >
          <span className={styles.statusDot} aria-hidden="true" />
          {server.state === 'online'
            ? `${shortCount(server.humans, t('menu.thousand'))} ${t('menu.inNet')}`
            : server.state === 'offline'
              ? t('menu.offline')
              : t('menu.checking')}
        </p>
        <p className={styles.brand}>Hexfront</p>
        <button
          type="button"
          className={styles.gear}
          aria-label={t('settings.title')}
          onClick={() => setSettingsOpen(true)}
        >
          <IconSettings size={24} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.nickSlot}>
        <NickPlate settings={settings} update={update} shake={shake} />
      </div>
      <MenuDock
        settings={settings}
        update={update}
        go={go}
        mode={mode}
        onMode={setMode}
        offline={offline}
      />
      {lobbyWindow.mounted && lastLobby.current !== null && (
        <div className={styles.panelSlot}>
          <LobbyPanel
            request={lastLobby.current}
            nick={settings.nickname}
            onClose={() => setLobby(null)}
            className={lobbyWindow.className}
          />
        </div>
      )}
      {askWindow.mounted && (
        <div className={styles.backdrop}>
          <div
            className={`${styles.modal} ${askWindow.className}`}
            role="dialog"
            aria-modal="true"
            aria-label={t('tutorial.askTitle')}
          >
            <h1 className={styles.askTitle}>{t('tutorial.askTitle')}</h1>
            <p className={styles.askText}>{t('tutorial.askText')}</p>
            <div className={styles.askActions}>
              <button
                type="button"
                className={`${styles.action} ${styles.primary}`}
                onClick={() => {
                  closeAsk();
                  go(tutorialLink(settings));
                }}
              >
                {t('tutorial.askYes')}
              </button>
              <button type="button" className={styles.action} onClick={closeAsk}>
                {t('tutorial.askNo')}
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsWindow.mounted && (
        <div className={styles.backdrop}>
          <div
            className={`${styles.modal} ${settingsWindow.className}`}
            role="dialog"
            aria-modal="true"
            aria-label={t('settings.title')}
          >
            <SettingsScreen onBack={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}
    </main>
  );
}
