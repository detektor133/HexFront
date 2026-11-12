// Главное меню: фоном идёт партия ботов, внизу док режимов, над ним ник и цвет. Настройки игры и
// вопрос про обучение — окна с анимацией «телевизора».
import { IconSettings } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MenuDock } from './MenuDock.tsx';
import { NickPlate, tutorialLink, type ModeId } from './MenuParts.tsx';
import { t } from '../i18n/dict.ts';
import { isCoarsePointer } from '../input/touch-tap.ts';
import { navigate } from '../nav.ts';
import { nickProblem, useMenuSettings } from './menu-config.ts';
import styles from './menu-ui.module.css';
import { useMenuBackground } from './use-menu-background.ts';
import { SettingsScreen } from '../settings/SettingsScreen.tsx';
import { fullscreenWanted, setFullscreen } from '../settings/fullscreen.ts';
import { markAsked, wasAsked } from '../tutorial/engine.ts';
import { useTvPresence } from '../ui/use-tv-presence.ts';

export function MainMenu(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [settings, update] = useMenuSettings();
  const [mode, setMode] = useState<ModeId | null>(null);
  const [shake, setShake] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState<boolean>(() => !wasAsked());
  const settingsWindow = useTvPresence(settingsOpen);
  const askWindow = useTvPresence(askOpen);
  useMenuBackground(hostRef, settings.color);

  // Переход в режим: сначала проверяем ник, на телефоне включаем полный экран (нужен жест).
  const go = useCallback(
    (url: string): void => {
      if (nickProblem(settings.nickname)) {
        setShake((n) => n + 1);
        return;
      }
      if (isCoarsePointer() && fullscreenWanted()) void setFullscreen(true);
      navigate(url);
    },
    [settings.nickname],
  );

  useEffect(() => {
    if (!settingsOpen && mode === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (settingsOpen) setSettingsOpen(false);
      else setMode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, mode]);

  const closeAsk = (): void => {
    markAsked();
    setAskOpen(false);
  };

  return (
    <main className={styles.page}>
      <div ref={hostRef} className={styles.background} aria-hidden="true" />
      <div className={styles.top}>
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
      <MenuDock settings={settings} update={update} go={go} mode={mode} onMode={setMode} />
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
