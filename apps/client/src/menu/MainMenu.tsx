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
import { TutorialAsk, TutorialChapters } from './TutorialMenu.tsx';
import { playerColorIds } from '../theme/colors.ts';
import { chooseTheme, currentTheme, themeIds, type ThemeId } from '../theme/theme.ts';
import { tokens } from '../theme/tokens.ts';
import { markAsked, wasAsked } from '../tutorial/engine.ts';

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

function readStorage(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

// Ссылка на матч: случайная карта — как раньше (готовые зёрна), остальные — по id карты.
function matchUrl(nickname: string, color: string, map: MenuMap, players: number): string {
  const start =
    map === 'gen'
      ? quickMatchUrl()
      : `/match?map=${map}&seed=42&players=${map === 'europe' ? players : 2}`;
  const url = new URL(start, window.location.origin);
  if (nickname !== '') url.searchParams.set('name', nickname);
  url.searchParams.set('color', color);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

/** Главное меню быстрого локального матча. */
export function MainMenu(): React.JSX.Element {
  const backgroundHostRef = useRef<HTMLDivElement>(null);
  const colorsRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<LocalMatch | null>(null);
  const [nickname, setNickname] = useState<string>(() => readStorage(NICKNAME_KEY, ''));
  const [color, setColor] = useState<string>(() => readStorage(COLOR_KEY, 'teal'));
  const [theme, setTheme] = useState<ThemeId>(currentTheme);
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
  const chooser = MAPS.find((m) => m.id === map);
  // Новичку один раз предлагают обучение; позже оно открывается кнопкой в меню.
  const [askOpen, setAskOpen] = useState<boolean>(() => !wasAsked());
  const [chaptersOpen, setChaptersOpen] = useState<boolean>(false);

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
      mapView = await createMapView(
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
      if (disposed) return;
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

  const handlePlay = (): void => {
    localStorage.setItem(NICKNAME_KEY, nickname);
    localStorage.setItem(MAP_KEY, map);
    localStorage.setItem(PLAYERS_KEY, String(players));
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
        ) : chaptersOpen ? (
          <TutorialChapters name={nickname} color={color} onClose={() => setChaptersOpen(false)} />
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
            <div className={styles.field}>
              <span className={styles.label}>{t('settings.theme')}</span>
              <div className={styles.segmented} role="radiogroup" aria-label={t('settings.theme')}>
                {themeIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={id === theme}
                    className={`${styles.segment} ${id === theme ? styles.chosen : ''}`}
                    onClick={() => {
                      chooseTheme(id);
                      setTheme(id);
                    }}
                  >
                    <span>{t(`theme.${id}`)}</span>
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
              href={matchUrl(nickname, color, map, players)}
              onClick={handlePlay}
            >
              {t('menu.play')}
            </a>
            <button
              type="button"
              className={styles.tutorialButton}
              onClick={() => setChaptersOpen(true)}
            >
              {t('tutorial.menuButton')}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
