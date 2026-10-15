import { useEffect, useRef, useState } from 'react';

import { t } from '../i18n/dict.ts';
import { startLocalMatch, type LocalMatch } from '../local/local-match.ts';
import { quickMatchUrl } from '../routes.ts';
import styles from './MainMenu.module.css';
import { playerColorIds } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

const NICKNAME_KEY = 'hexfront.nickname';
const COLOR_KEY = 'hexfront.color';
const AUTO_COMMAND_KEY = 'hexfront.auto-command';

function readStorage(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

function matchUrl(nickname: string, color: string): string {
  const url = new URL(quickMatchUrl(), window.location.origin);
  if (nickname !== '') url.searchParams.set('name', nickname);
  url.searchParams.set('color', color);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

/** Главное меню быстрого локального матча. */
export function MainMenu(): React.JSX.Element {
  const backgroundRef = useRef<LocalMatch | null>(null);
  const [nickname, setNickname] = useState<string>(() => readStorage(NICKNAME_KEY, ''));
  const [color, setColor] = useState<string>(() => readStorage(COLOR_KEY, 'teal'));
  const [autoCommand, setAutoCommand] = useState<boolean>(
    () => readStorage(AUTO_COMMAND_KEY, 'false') === 'true',
  );

  useEffect(() => {
    const startBackground = (playerColors: readonly string[]): void => {
      backgroundRef.current?.dispose();
      backgroundRef.current = startLocalMatch(
        'small',
        1,
        { count: 6, bots: [0, 1, 2, 3, 4, 5], speed: 1 },
        () => undefined,
        { fog: false, playerColors },
      );
    };
    startBackground(playerColorIds(color).slice(0, 2));
    return () => backgroundRef.current?.dispose();
  }, [color]);

  const handleColor = (next: string): void => {
    setColor(next);
    localStorage.setItem(COLOR_KEY, next);
  };

  const handlePlay = (): void => {
    localStorage.setItem(NICKNAME_KEY, nickname);
    localStorage.setItem(AUTO_COMMAND_KEY, String(autoCommand));
  };

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="main-menu-title">
        <p className={styles.wordmark}>Hexfront</p>
        <h1 id="main-menu-title" className={styles.title}>
          {t('menu.title')}
        </h1>
        <p className={styles.subtitle}>{t('menu.subtitle')}</p>
        <label className={styles.field}>
          <span>{t('menu.nickname')}</span>
          <input
            value={nickname}
            maxLength={16}
            onChange={(event) => setNickname(event.target.value.slice(0, 16))}
          />
        </label>
        <div className={styles.field}>
          <span>{t('menu.color')}</span>
          <div className={styles.colors}>
            {tokens.players.palette.map((playerColor) => (
              <button
                key={playerColor.id}
                type="button"
                className={`${styles.color} ${playerColor.id === color ? styles.selected : ''}`}
                aria-label={`${t('menu.color')} ${playerColor.id}`}
                style={{ backgroundColor: playerColor.line }}
                onClick={() => handleColor(playerColor.id)}
              />
            ))}
          </div>
        </div>
        <a
          className={styles.play}
          role="button"
          href={matchUrl(nickname, color)}
          onClick={handlePlay}
        >
          {t('menu.play')}
        </a>
        <section className={styles.section} aria-labelledby="how-to-play-title">
          <h2 id="how-to-play-title">{t('menu.howToPlay')}</h2>
          <div className={styles.tutorials}>
            {(['auto', 'tax', 'front', 'offensive'] as const).map((key) => (
              <article key={key} className={styles.tutorial}>
                <h3>{t(`onboarding.${key}.title`)}</h3>
                <p>{t(`onboarding.${key}.text`)}</p>
              </article>
            ))}
          </div>
        </section>
        <section className={styles.section} aria-labelledby="settings-title">
          <h2 id="settings-title">{t('menu.settings')}</h2>
          <button
            type="button"
            className={styles.secondary}
            aria-pressed={autoCommand}
            onClick={() => setAutoCommand((value) => !value)}
          >
            {t('menu.autoCommand')}
          </button>
          {'requestFullscreen' in document.documentElement && (
            <button type="button" className={styles.secondary}>
              {t('menu.fullscreen')}
            </button>
          )}
        </section>
      </section>
    </main>
  );
}
