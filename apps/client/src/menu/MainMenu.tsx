import { IconSettings } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import { t, type MessageKey } from '../i18n/dict.ts';
import { isCoarsePointer } from '../input/touch-tap.ts';
import { followInApp, navigate } from '../nav.ts';
import { quickMatchUrl } from '../routes.ts';
import styles from './MainMenu.module.css';
import { MenuMap, type MenuTerritory } from './MenuMap.tsx';
import { TutorialAsk } from './TutorialMenu.tsx';
import { COLOR_KEY, NICKNAME_KEY } from './storage-keys.ts';
import { useMenuBackground } from './use-menu-background.ts';
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

/** Случайное зерно матча на Европе: стартовые позиции и порядок игроков каждый раз другие. */
function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

// Ссылка на матч: случайная карта — как раньше (готовые зёрна), остальные — по id карты.
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

/** Тёмный или светлый текст на заливке `background`: что контрастнее по яркости. */
function inkOn(background: string): string {
  const value = Number.parseInt(background.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150 ? 'var(--ui-ink)' : 'var(--ui-surface)';
}

type Panel = 'none' | 'bots' | 'profile' | 'settings';

/** Главное меню: живая карта на весь экран, режимы — страны на ней. */
export function MainMenu(): React.JSX.Element {
  const backgroundHostRef = useRef<HTMLDivElement>(null);
  const [nickname, setNickname] = useState<string>(() => readStorage(NICKNAME_KEY, ''));
  const [color, setColor] = useState<string>(() => readStorage(COLOR_KEY, 'teal'));
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
  // Новичку один раз предлагают обучение; позже оно открывается страной на карте.
  const [askOpen, setAskOpen] = useState<boolean>(() => !wasAsked());
  const palette = tokens.players.palette;
  const colorLine = palette.find((p) => p.id === color)?.line ?? palette[0]?.line ?? '';
  const others = palette.filter((p) => p.id !== color);

  useMenuBackground(backgroundHostRef, color);

  useEffect(() => {
    if (panel === 'none') return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPanel('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  // Ник, цвет и настройки матча запоминаются сразу: лобби и матч читают их из хранилища.
  const save = (): void => {
    localStorage.setItem(NICKNAME_KEY, nickname);
    localStorage.setItem(COLOR_KEY, color);
    localStorage.setItem(MAP_KEY, map);
    localStorage.setItem(PLAYERS_KEY, String(players));
    localStorage.setItem(LEVEL_KEY, level);
  };

  // Режимы на телефоне сразу включают полный экран (нужен жест, это он) и ведут в матч внутри
  // страницы: перезагрузка вывела бы браузер из полного экрана.
  const go = (url: string, store: boolean): void => {
    if (store) save();
    if (isCoarsePointer() && fullscreenWanted()) void setFullscreen(true);
    navigate(url);
  };

  const playUrl = matchUrl(nickname, color, map, players, level);
  const sheetOpen = askOpen || panel === 'bots' || panel === 'profile';
  const closePanel = (): void => {
    save();
    setPanel('none');
  };

  const territories: readonly MenuTerritory[] = [
    {
      id: 'online',
      label: t('menu.online'),
      sub: t('menu.subOnline'),
      fill: colorLine,
      ink: inkOn(colorLine),
      onActivate: () => go('/online', true),
    },
    {
      id: 'bots',
      label: t('menu.bots'),
      sub: t('menu.subBots'),
      fill: others[2]?.line ?? colorLine,
      ink: inkOn(others[2]?.line ?? colorLine),
      onActivate: () => setPanel('bots'),
    },
    {
      id: 'friends',
      label: t('menu.friends'),
      sub: t('menu.subFriends'),
      fill: others[5]?.line ?? colorLine,
      ink: inkOn(others[5]?.line ?? colorLine),
      onActivate: () => go('/online?mode=private', true),
    },
    {
      id: 'tutorial',
      label: t('tutorial.menuButton'),
      sub: t('menu.subTutorial'),
      fill: 'var(--ui-surface)',
      ink: 'var(--ui-ink)',
      onActivate: () => go(tutorialUrl(nickname, color), false),
    },
    {
      id: 'profile',
      label: (nickname === '' ? t('menu.defaultNick') : nickname).slice(0, 10),
      sub: t('menu.subProfile'),
      fill: `color-mix(in srgb, ${colorLine} 40%, var(--ui-surface))`,
      ink: 'var(--ui-ink)',
      onActivate: () => setPanel('profile'),
    },
  ];

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
          <IconSettings size={22} aria-hidden="true" />
        </button>
      </header>

      <section className={styles.mapArea} aria-label="Hexfront">
        <MenuMap territories={territories} />
      </section>

      {sheetOpen && (
        <div
          className={styles.backdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !askOpen) closePanel();
          }}
        >
          <div
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={t('menu.setup')}
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
            ) : panel === 'profile' ? (
              <>
                <h1 className={styles.title}>{t('menu.profile')}</h1>
                <label className={`${styles.field} ${styles.nickname}`}>
                  <span>{t('menu.nickname')}</span>
                  <input
                    value={nickname}
                    maxLength={16}
                    autoFocus
                    placeholder={t('menu.defaultNick')}
                    onChange={(event) => setNickname(event.target.value.slice(0, 16))}
                  />
                </label>
                <div className={styles.field}>
                  <span className={styles.label}>{t('menu.color')}</span>
                  <div className={styles.swatches} role="radiogroup" aria-label={t('menu.color')}>
                    {palette.map((playerColor) => (
                      <button
                        key={playerColor.id}
                        type="button"
                        role="radio"
                        aria-checked={playerColor.id === color}
                        aria-label={`${t('menu.color')} ${playerColor.id}`}
                        className={`${styles.swatch} ${playerColor.id === color ? styles.selected : ''}`}
                        style={{ backgroundColor: playerColor.line }}
                        onClick={() => setColor(playerColor.id)}
                      />
                    ))}
                  </div>
                </div>
                <button type="button" className={styles.play} onClick={closePanel}>
                  {t('menu.done')}
                </button>
              </>
            ) : (
              <>
                <h1 className={styles.title}>{t('menu.bots')}</h1>
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
                    className={styles.levels}
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
                <a
                  className={styles.play}
                  role="button"
                  href={playUrl}
                  onClick={(event) => {
                    save();
                    if (isCoarsePointer() && fullscreenWanted()) void setFullscreen(true);
                    followInApp(event, playUrl);
                  }}
                >
                  {t('menu.play')}
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {panel === 'settings' && (
        <div className={styles.fullscreen}>
          <SettingsScreen onBack={closePanel} />
        </div>
      )}
    </main>
  );
}
