// Главное меню: фоном карта (в комнате — та, на которой будем играть, с выбором места старта), внизу док режимов, над ним ник и цвет. Настройки игры и
// вопрос про обучение — окна с анимацией «телевизора».
import { IconChevronDown, IconChevronUp, IconSettings } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { hexId, planStarts, type MapStatic } from '@hexfront/sim';

import { LobbyPanel, lobbyFromUrl, type LobbyRequest } from './LobbyPanel.tsx';
import { MenuDock } from './MenuDock.tsx';
import { NickPlate, tutorialLink, type ModeId } from './MenuParts.tsx';
import { useLobbyStarts } from './lobby-starts.ts';
import styles from './menu-ui.module.css';
import { t } from '../i18n/dict.ts';
import { navigate } from '../nav.ts';
import {
  guestNick,
  maxPlayersOf,
  nickProblem,
  useMenuSettings,
  type MenuMapId,
} from './menu-config.ts';
import type { StartMarker } from './starts-layer.ts';
import { useMenuBackground } from './use-menu-background.ts';
import { shortCount, useServerStatus } from './use-server-status.ts';
import { isCoarsePointer } from '../input/touch-tap.ts';
import { SettingsScreen } from '../settings/SettingsScreen.tsx';
import {
  enterFullscreenOnFirstTap,
  fullscreenWanted,
  setFullscreen,
} from '../settings/fullscreen.ts';
import { tokens } from '../theme/tokens.ts';
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
  // Карта комнаты, пока открыто лобби: фон показывает её, а не выбор в меню «Против ботов».
  const [room, setRoom] = useState<{ id: MenuMapId; seed: number; size: number } | null>(null);
  const inLobby = lobby !== null;
  const lobbyState = useLobbyStarts();
  const pickable = inLobby ? lobbyState.pick !== null : mode === 'bots';
  const [background, setBackground] = useState<MapStatic | null>(null);
  // Панели снизу можно спрятать, чтобы выбрать место на всей карте; закрытие режима возвращает их.
  const [collapsedRaw, setCollapsed] = useState(false);
  const collapsed = collapsedRaw && pickable;
  useEffect(() => {
    if (!pickable) setCollapsed(false);
  }, [pickable]);
  const markers = useMemo<readonly StartMarker[]>(() => {
    const palette = tokens.players.palette;
    if (inLobby) {
      return lobbyState.starts.map((hex, index) => ({
        hex,
        color: palette[index % palette.length]?.line ?? tokens.ui.ink,
        mine: index === lobbyState.me,
        bot: index >= lobbyState.humans,
      }));
    }
    if (mode !== 'bots' || background === null) return [];
    const players = Math.min(settings.players, maxPlayersOf(settings.map, settings.genSize));
    const wanted = [settings.start, ...Array.from({ length: players - 1 }, () => null)];
    const mine = palette.find((p) => p.id === settings.color)?.line ?? tokens.ui.ink;
    return planStarts(background, settings.seed >>> 0, wanted).map((hex, index) => ({
      hex: hexId(hex, background.width),
      color: index === 0 ? mine : tokens.ui.ink3,
      mine: index === 0,
      bot: index > 0,
    }));
  }, [inLobby, lobbyState, mode, background, settings]);
  const onPick = useMemo(
    () =>
      inLobby
        ? lobbyState.pick
        : mode === 'bots'
          ? (hex: number): void => update({ start: hex })
          : null,
    [inLobby, lobbyState.pick, mode, update],
  );
  const loadedMap = useMenuBackground(
    hostRef,
    {
      id: room?.id ?? settings.map,
      seed: room?.seed ?? settings.seed,
      size: room?.size ?? settings.genSize,
      players: 6,
    },
    { markers, onPick },
  );
  useEffect(() => setBackground(loadedMap), [loadedMap]);
  // Браузер даёт полный экран только по жесту: первое касание в меню на телефоне разворачивает игру.
  useEffect(() => enterFullscreenOnFirstTap(), []);
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
    <main className={`${styles.page} ${collapsed ? styles.collapsed : ''}`}>
      <div ref={hostRef} className={styles.background} aria-hidden="true" />
      <div className={styles.top}>
        <p
          className={`${styles.status} ${server.state === 'online' ? styles.live : ''} ${server.state === 'offline' ? styles.down : ''}`}
          role="status"
        >
          <span className={styles.statusDot} aria-hidden="true" />
          {server.state === 'online'
            ? server.humans === null
              ? t('menu.serverUp')
              : `${shortCount(server.humans, t('menu.thousand'))} ${t('menu.inNet')}`
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
        {pickable && (
          <p className={styles.pickHint} role="note">
            {t(inLobby ? 'menu.pickHintLobby' : 'menu.pickHint')}
          </p>
        )}
        {pickable && (
          <button
            type="button"
            className={styles.collapseBtn}
            aria-pressed={collapsed}
            onClick={() => setCollapsed((now) => !now)}
          >
            {collapsed ? (
              <IconChevronUp size={18} aria-hidden="true" />
            ) : (
              <IconChevronDown size={18} aria-hidden="true" />
            )}
            {t(collapsed ? 'menu.showPanels' : 'menu.hidePanels')}
          </button>
        )}
      </div>
      <div className={styles.nickSlot}>
        <NickPlate settings={settings} update={update} shake={shake} />
      </div>
      <MenuDock
        settings={settings}
        update={update}
        go={go}
        mode={mode}
        onMode={(next) => {
          // Выбор режима закрывает открытое лобби: иначе оно висит поверх и режим не переключить.
          setLobby(null);
          setMode(next);
        }}
        offline={offline}
      />
      {lobbyWindow.mounted && lastLobby.current !== null && (
        <div className={styles.panelSlot}>
          <LobbyPanel
            request={lastLobby.current}
            nick={settings.nickname}
            onClose={() => {
              setRoom(null);
              setLobby(null);
            }}
            onRoomMap={(id, seed, size) =>
              setRoom((prev) =>
                prev?.id === id && prev.seed === seed && prev.size === size
                  ? prev
                  : { id, seed, size },
              )
            }
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
