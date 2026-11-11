import { useEffect, useRef, useState } from 'react';

import { t, type MessageKey } from '../i18n/dict.ts';
import { quickMatchUrl } from '../routes.ts';
import styles from './MainMenu.module.css';
import { TutorialAsk } from './TutorialMenu.tsx';
import hex from './hex.module.css';
import { COLOR_KEY, NICKNAME_KEY } from './storage-keys.ts';
import { useMenuBackground } from './use-menu-background.ts';
import { isCoarsePointer } from '../input/touch-tap.ts';
import { followInApp } from '../nav.ts';
import { SettingsScreen } from '../settings/SettingsScreen.tsx';
import { fullscreenWanted, setFullscreen } from '../settings/fullscreen.ts';
import { tokens } from '../theme/tokens.ts';
import { markAsked, wasAsked } from '../tutorial/engine.ts';
import { tutorialUrl } from '../tutorial/links.ts';

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

/** Чёрный или белый текст на плитке цвета `background`: что контрастнее по яркости. */
function inkOn(background: string): string {
  const value = Number.parseInt(background.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150 ? 'var(--ui-ink)' : 'var(--ui-surface)';
}

/** Положение плитки в сотах: центр (в долях --s от центра большой плитки) и ширина. */
function slot(cx: number, cy: number, width: number): React.CSSProperties {
  return { '--cx': cx, '--cy': cy, '--w': width } as React.CSSProperties;
}

type Panel = 'none' | 'setup' | 'settings';

/** Главное меню: живая карта на весь экран и соты-кнопки режимов поверх неё. */
export function MainMenu(): React.JSX.Element {
  const backgroundHostRef = useRef<HTMLDivElement>(null);
  const colorsRef = useRef<HTMLDivElement>(null);
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
  const [panel, setPanel] = useState<Panel>('none');
  // Новичку один раз предлагают обучение; позже оно открывается плиткой в сотах.
  const [askOpen, setAskOpen] = useState<boolean>(() => !wasAsked());
  const paletteColor = tokens.players.palette.find((p) => p.id === color);
  const colorLine =
    paletteColor?.line ?? tokens.players.palette[0]?.line ?? 'var(--selection-color)';

  useMenuBackground(backgroundHostRef, color);

  useEffect(() => {
    const closeColorPicker = (event: MouseEvent): void => {
      if (!colorsRef.current?.contains(event.target as Node)) {
        setIsColorPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', closeColorPicker);
    return () => document.removeEventListener('mousedown', closeColorPicker);
  }, []);

  useEffect(() => {
    if (panel === 'none') return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPanel('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  const handleColor = (next: string): void => {
    setColor(next);
    localStorage.setItem(COLOR_KEY, next);
  };

  // Настройки матча запоминаются сразу: «Играть» читает их при нажатии, а лобби — ник и цвет.
  const save = (): void => {
    localStorage.setItem(NICKNAME_KEY, nickname);
    localStorage.setItem(MAP_KEY, map);
    localStorage.setItem(PLAYERS_KEY, String(players));
    localStorage.setItem(LEVEL_KEY, level);
  };

  // Режимы на телефоне сразу включают полный экран (нужен жест, это он) и ведут в матч внутри
  // страницы: перезагрузка вывела бы браузер из полного экрана.
  const enter = (event: React.MouseEvent<HTMLAnchorElement>, url: string, store: boolean): void => {
    if (store) save();
    if (isCoarsePointer() && fullscreenWanted()) void setFullscreen(true);
    followInApp(event, url);
  };

  const playUrl = matchUrl(nickname, color, map, players, level);
  const sheetOpen = askOpen || panel !== 'none';
  const closeSheet = (): void => {
    save();
    setIsColorPickerOpen(false);
    setPanel('none');
  };

  return (
    <main className={styles.page}>
      <div ref={backgroundHostRef} className={styles.background} aria-hidden="true" />
      <header className={styles.top}>
        <p className={`${styles.plate} ${styles.wordmark}`}>Hexfront</p>
        <button
          type="button"
          className={styles.plate}
          aria-label={t('settings.title')}
          onClick={() => setPanel('settings')}
        >
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
            <path
              d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <section className={styles.stage} aria-label="Hexfront">
        <a
          className={`${hex.hex} ${styles.tile} ${styles.big}`}
          style={
            {
              ...slot(0, 0, 1.5),
              '--edge': colorLine,
              '--fill': colorLine,
              '--fill-hover': `color-mix(in srgb, ${colorLine} 88%, ${inkOn(colorLine)})`,
              '--ink': inkOn(colorLine),
              '--sub': inkOn(colorLine),
            } as React.CSSProperties
          }
          role="button"
          href={playUrl}
          onClick={(event) => enter(event, playUrl, true)}
        >
          <span>{t('menu.play')}</span>
          <small>{`${t(`menu.map.${map}` as MessageKey)} · ${t(`menu.difficulty.${level}` as MessageKey)}`}</small>
        </a>
        <a
          className={`${hex.hex} ${styles.tile}`}
          style={slot(-0.65, 1.13, 1)}
          role="button"
          href="/online"
          onClick={(event) => enter(event, '/online', true)}
        >
          <span>{t('menu.online')}</span>
          <small>{t('menu.subOnline')}</small>
        </a>
        <a
          className={`${hex.hex} ${styles.tile}`}
          style={slot(0.65, 1.13, 1)}
          role="button"
          href="/online?mode=private"
          onClick={(event) => enter(event, '/online?mode=private', true)}
        >
          <span>{t('menu.friends')}</span>
          <small>{t('menu.subFriends')}</small>
        </a>
        <a
          className={`${hex.hex} ${styles.tile}`}
          style={slot(0, 1.94, 1)}
          role="button"
          href={tutorialUrl(nickname, color)}
          onClick={(event) => enter(event, tutorialUrl(nickname, color), false)}
        >
          <span>{t('tutorial.menuButton')}</span>
          <small>{t('menu.subTutorial')}</small>
        </a>
      </section>

      <button
        type="button"
        className={`${styles.plate} ${styles.profile}`}
        onClick={() => setPanel('setup')}
      >
        <span className={styles.dot} style={{ backgroundColor: colorLine }} aria-hidden="true" />
        <span>{nickname === '' ? t('menu.setup') : nickname}</span>
        <span className={styles.sub}>{nickname === '' ? '' : t('menu.setup')}</span>
      </button>

      {sheetOpen && (
        <div
          className={styles.backdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !askOpen) closeSheet();
          }}
        >
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-sheet-title"
          >
            {askOpen ? (
              <TutorialAsk
                name={nickname}
                color={color}
                onNo={() => {
                  markAsked();
                  setAskOpen(false);
                }}
              />
            ) : panel === 'settings' ? (
              <SettingsScreen onBack={closeSheet} />
            ) : (
              <>
                <h1 id="menu-sheet-title" className={styles.title}>
                  {t('menu.setup')}
                </h1>
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
                  <div
                    className={styles.segmented}
                    role="radiogroup"
                    aria-label={t('menu.difficulty')}
                  >
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
                    {!isColorPickerOpen && (
                      <button
                        type="button"
                        className={`${styles.color} ${styles.selected}`}
                        aria-label={`${t('menu.color')} ${color}`}
                        aria-expanded={false}
                        aria-haspopup="listbox"
                        style={{ backgroundColor: colorLine }}
                        onClick={() => setIsColorPickerOpen(true)}
                      />
                    )}
                    {isColorPickerOpen && (
                      <div className={styles.palette} role="listbox" aria-label={t('menu.color')}>
                        {tokens.players.palette.map((playerColor) => (
                          <button
                            key={playerColor.id}
                            type="button"
                            aria-label={`${t('menu.color')} ${playerColor.id}`}
                            aria-selected={playerColor.id === color}
                            className={`${styles.color} ${playerColor.id === color ? styles.selected : ''}`}
                            style={{ backgroundColor: playerColor.line }}
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
                <button type="button" className={styles.play} onClick={closeSheet}>
                  {t('menu.done')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
