import { useEffect, useRef, useState } from 'react';

import { loadMap } from '@hexfront/sim';

import { createEconomyLayer, type EconomyLayer } from '../dev/economy-layer.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import type { FromWorker } from '../local/messages.ts';
import { ViewDeltaApplier } from '../local/view-delta.ts';
import { createMapView, type MapView } from '../render/map-view.ts';
import { quickMatchUrl } from '../routes.ts';
import styles from './MainMenu.module.css';
import { TutorialAsk } from './TutorialMenu.tsx';
import { isCoarsePointer } from '../input/touch-tap.ts';
import { followInApp } from '../nav.ts';
import { SettingsScreen } from '../settings/SettingsScreen.tsx';
import { fullscreenWanted, setFullscreen } from '../settings/fullscreen.ts';
import { playerColorIds } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';
import { markAsked, wasAsked } from '../tutorial/engine.ts';
import { tutorialUrl } from '../tutorial/links.ts';

const EMPTY_SELECTION = { hex: null, units: [], target: null } as const;

const NICKNAME_KEY = 'hexfront.nickname';
const MAP_KEY = 'hexfront.map';
const PLAYERS_KEY = 'hexfront.players';

/** Карты меню: название, размер в гексах и можно ли выбирать число игроков. */
const MAPS = [
  { id: 'europe', size: '76×64', choosePlayers: true },
  { id: 'gen', size: '80×60', choosePlayers: false },
  { id: 'small', size: '40×30', choosePlayers: false },
  { id: 'tiny', size: '20×15', choosePlayers: false },
] as const;
type MenuMap = (typeof MAPS)[number]['id'];

const PLAYERS_MIN = 2;
const PLAYERS_MAX = 30;
const PLAYERS_DEFAULT = 12;
const COLOR_KEY = 'hexfront.color';
const LEVEL_KEY = 'hexfront.botLevel';
const LEVELS = ['easy', 'normal', 'hard'] as const;
type MenuLevel = (typeof LEVELS)[number];
const LEVEL_DEFAULT: MenuLevel = 'normal';

function readStorage(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

// Ссылка на матч: случайная карта — как раньше (готовые зёрна), остальные — по id карты.
/** Случайное зерно матча на Европе: стартовые позиции и порядок игроков каждый раз другие. */
function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function matchUrl(
  nickname: string,
  color: string,
  map: MenuMap,
  players: number,
  level: MenuLevel,
): string {
  const start =
    map === 'gen'
      ? quickMatchUrl()
      : `/match?map=${map}&seed=${map === 'europe' ? randomSeed() : 42}&players=${map === 'europe' ? players : 2}`;
  const url = new URL(start, window.location.origin);
  if (nickname !== '') url.searchParams.set('name', nickname);
  url.searchParams.set('color', color);
  url.searchParams.set('difficulty', level);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

/** Главное меню быстрого локального матча. */
export function MainMenu(): React.JSX.Element {
  const backgroundHostRef = useRef<HTMLDivElement>(null);
  const colorsRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<LocalMatch | null>(null);
  const [nickname, setNickname] = useState<string>(() => readStorage(NICKNAME_KEY, ''));
  const [color, setColor] = useState<string>(() => readStorage(COLOR_KEY, 'teal'));
  const [isColorPickerOpen, setIsColorPickerOpen] = useState<boolean>(false);
  const [map, setMap] = useState<MenuMap>(() => {
    const saved = readStorage(MAP_KEY, 'europe');
    return MAPS.find((m) => m.id === saved)?.id ?? 'europe';
  });
  const [players, setPlayers] = useState<number>(() => {
    const saved = Number(readStorage(PLAYERS_KEY, String(PLAYERS_DEFAULT)));
    return Number.isInteger(saved)
      ? Math.min(PLAYERS_MAX, Math.max(PLAYERS_MIN, saved))
      : PLAYERS_DEFAULT;
  });
  const [level, setLevel] = useState<MenuLevel>(() => {
    const saved = readStorage(LEVEL_KEY, LEVEL_DEFAULT);
    return LEVELS.find((l) => l === saved) ?? LEVEL_DEFAULT;
  });
  const chooser = MAPS.find((m) => m.id === map);
  // Новичку один раз предлагают обучение; позже оно открывается кнопкой в меню.
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [askOpen, setAskOpen] = useState<boolean>(() => !wasAsked());

  useEffect(() => {
    let disposed = false;
    let mapView: MapView | null = null;
    let layer: EconomyLayer | null = null;
    let pendingMessage: Extract<FromWorker, { t: 'view' }> | null = null;
    const deltaApplier = new ViewDeltaApplier();
    const applyMessage = (message: Extract<FromWorker, { t: 'view' }>): void => {
      if (layer === null) {
        pendingMessage = message;
        return;
      }
      const view =
        message.kind === 'snapshot'
          ? deltaApplier.applySnapshot(message.snapshot)
          : deltaApplier.applyDelta(message.delta);
      layer.setView(view, EMPTY_SELECTION);
      layer.frame(performance.now());
    };
    backgroundRef.current = startLocalMatch(
      'small',
      1,
      { count: 6, bots: [0, 1, 2, 3, 4, 5], speed: 1 },
      (message: FromWorker): void => {
        if (message.t === 'view') applyMessage(message);
      },
      { fog: false, playerColors: playerColorIds(color).slice(0, 2) },
    );
    const startBackground = async (): Promise<void> => {
      const response = await fetch('/maps/small.json');
      const json: unknown = await response.json();
      const loaded = loadMap(json);
      if (disposed || !loaded.ok || backgroundHostRef.current === null) return;
      const created = await createMapView(
        backgroundHostRef.current,
        loaded.map,
        {
          radius: tokens.map.hexRadius,
          midLayer: (map, radius) => {
            layer = createEconomyLayer(map, radius);
            return layer;
          },
        },
        () => undefined,
      );
      // Меню закрыли, пока холст готовился (быстрое «Играть»): отдать его сразу, иначе он останется
      // в памяти вместе с контекстом WebGL.
      if (disposed) {
        created.destroy();
        return;
      }
      mapView = created;
      if (pendingMessage !== null) applyMessage(pendingMessage);
    };
    void startBackground();
    return () => {
      disposed = true;
      backgroundRef.current?.dispose();
      layer?.destroy();
      mapView?.destroy();
      backgroundRef.current = null;
    };
  }, [color]);

  useEffect(() => {
    const closeColorPicker = (event: MouseEvent): void => {
      if (!colorsRef.current?.contains(event.target as Node)) {
        setIsColorPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', closeColorPicker);
    return () => document.removeEventListener('mousedown', closeColorPicker);
  }, []);

  const handleColor = (next: string): void => {
    setColor(next);
    localStorage.setItem(COLOR_KEY, next);
  };

  // «Играть» и «Обучение» на телефоне сразу включают полный экран (нужен жест, это он) и ведут в
  // матч внутри страницы: перезагрузка вывела бы браузер из полного экрана.
  const enter = (event: React.MouseEvent<HTMLAnchorElement>, url: string, save: boolean): void => {
    if (save) handlePlay();
    if (isCoarsePointer() && fullscreenWanted()) void setFullscreen(true);
    followInApp(event, url);
  };

  const handlePlay = (): void => {
    localStorage.setItem(NICKNAME_KEY, nickname);
    localStorage.setItem(MAP_KEY, map);
    localStorage.setItem(PLAYERS_KEY, String(players));
    localStorage.setItem(LEVEL_KEY, level);
  };

  return (
    <main className={styles.page}>
      <div ref={backgroundHostRef} className={styles.background} aria-hidden="true" />
      <section className={styles.card} aria-labelledby="main-menu-title">
        <p className={styles.wordmark}>Hexfront</p>
        {askOpen ? (
          <TutorialAsk
            name={nickname}
            color={color}
            onNo={() => {
              markAsked();
              setAskOpen(false);
            }}
          />
        ) : settingsOpen ? (
          <SettingsScreen onBack={() => setSettingsOpen(false)} />
        ) : (
          <>
            <h1 id="main-menu-title" className={styles.title}>
              {t('menu.title')}
            </h1>
            <p className={styles.subtitle}>{t('menu.subtitle')}</p>
            <div className={styles.field}>
              <span className={styles.label}>{t('menu.map')}</span>
              <div className={styles.segmented} role="radiogroup" aria-label={t('menu.map')}>
                {MAPS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={m.id === map}
                    className={`${styles.segment} ${m.id === map ? styles.chosen : ''}`}
                    onClick={() => setMap(m.id)}
                  >
                    <span>{t(`menu.map.${m.id}` as MessageKey)}</span>
                    <small>{m.size}</small>
                  </button>
                ))}
              </div>
            </div>
            {chooser?.choosePlayers && (
              <label className={styles.field}>
                <span className={styles.label}>{`${t('menu.players')}: ${players}`}</span>
                <input
                  type="range"
                  min={PLAYERS_MIN}
                  max={PLAYERS_MAX}
                  value={players}
                  onChange={(event) => setPlayers(Number(event.target.value))}
                />
              </label>
            )}
            <div className={styles.field}>
              <span className={styles.label}>{t('menu.difficulty')}</span>
              <div className={styles.segmented} role="radiogroup" aria-label={t('menu.difficulty')}>
                {LEVELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={l === level}
                    className={`${styles.segment} ${l === level ? styles.chosen : ''}`}
                    onClick={() => setLevel(l)}
                  >
                    <span>{t(`menu.difficulty.${l}` as MessageKey)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.identityRow}>
              <div ref={colorsRef} className={styles.colorPicker}>
                {!isColorPickerOpen &&
                  tokens.players.palette
                    .filter((playerColor) => playerColor.id === color)
                    .map((playerColor) => (
                      <button
                        key={playerColor.id}
                        type="button"
                        className={`${styles.color} ${playerColor.id === color ? styles.selected : ''}`}
                        aria-label={`${t('menu.color')} ${playerColor.id}`}
                        aria-expanded={isColorPickerOpen}
                        aria-haspopup="listbox"
                        style={{ backgroundColor: playerColor.line, width: '28px', height: '28px' }}
                        onClick={() => {
                          if (!isColorPickerOpen) {
                            setIsColorPickerOpen(true);
                            return;
                          }
                          handleColor(playerColor.id);
                          setIsColorPickerOpen(false);
                        }}
                      />
                    ))}
                {isColorPickerOpen && (
                  <div
                    className={styles.palette}
                    role="listbox"
                    aria-label={t('menu.color')}
                    style={{ gridTemplateColumns: '28px 28px 28px 28px 28px 28px' }}
                  >
                    {tokens.players.palette.map((playerColor) => (
                      <button
                        key={playerColor.id}
                        type="button"
                        aria-label={`${t('menu.color')} ${playerColor.id}`}
                        aria-selected={playerColor.id === color}
                        className={`${styles.color} ${playerColor.id === color ? styles.selected : ''}`}
                        style={{ backgroundColor: playerColor.line, width: '28px', height: '28px' }}
                        onClick={() => {
                          handleColor(playerColor.id);
                          setIsColorPickerOpen(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <label className={styles.nickname}>
                <span>{t('menu.nickname')}</span>
                <input
                  value={nickname}
                  maxLength={16}
                  onChange={(event) => setNickname(event.target.value.slice(0, 16))}
                />
              </label>
            </div>
            <a
              className={styles.play}
              role="button"
              href={matchUrl(nickname, color, map, players, level)}
              onClick={(event) =>
                enter(event, matchUrl(nickname, color, map, players, level), true)
              }
            >
              {t('menu.play')}
            </a>
            <a
              className={styles.tutorialButton}
              role="button"
              href={tutorialUrl(nickname, color)}
              onClick={(event) => enter(event, tutorialUrl(nickname, color), false)}
            >
              {t('tutorial.menuButton')}
            </a>
            <button
              type="button"
              className={styles.settingsButton}
              onClick={() => setSettingsOpen(true)}
            >
              {t('settings.title')}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
