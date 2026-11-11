// Оболочка меню: выбирает вид (классика и три новых), держит фон-карту, ник, настройки игры и
// вопрос про обучение. Переключатель видов временный: владелец выбирает, какой оставить.
import { IconSettings } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isCoarsePointer } from '../input/touch-tap.ts';
import { navigate } from '../nav.ts';
import classic from './MainMenu.module.css';
import { MainMenu } from './MainMenu.tsx';
import { MenuCards } from './MenuCards.tsx';
import { MenuCities } from './MenuCities.tsx';
import { MenuDock } from './MenuDock.tsx';
import { NickPlate } from './MenuParts.tsx';
import { nickProblem, useMenuSettings } from './menu-config.ts';
import styles from './menu-ui.module.css';
import variants from './menu-variants.module.css';
import { useMenuBackground } from './use-menu-background.ts';
import { t } from '../i18n/dict.ts';
import { SettingsScreen } from '../settings/SettingsScreen.tsx';
import { fullscreenWanted, setFullscreen } from '../settings/fullscreen.ts';
import { markAsked, wasAsked } from '../tutorial/engine.ts';
import { tutorialUrl } from '../tutorial/links.ts';

const VARIANT_KEY = 'hexfront.menuVariant';
const VARIANTS = [
  { id: 'classic', label: '1' },
  { id: 'cities', label: '2' },
  { id: 'cards', label: '3' },
  { id: 'dock', label: '4' },
] as const;
type VariantId = (typeof VARIANTS)[number]['id'];

function readVariant(): VariantId {
  const asked = new URLSearchParams(window.location.search).get('menu');
  const saved = (() => {
    try {
      return localStorage.getItem(VARIANT_KEY);
    } catch {
      return null;
    }
  })();
  return (
    VARIANTS.find((v) => v.id === asked)?.id ?? VARIANTS.find((v) => v.id === saved)?.id ?? 'cities'
  );
}

function Switcher(props: {
  readonly current: VariantId;
  readonly onPick: (id: VariantId) => void;
}): React.JSX.Element {
  return (
    <div className={styles.switcher} role="group" aria-label={t('menu.variant')}>
      {VARIANTS.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`${styles.variant} ${props.current === v.id ? styles.on : ''}`}
          aria-pressed={props.current === v.id}
          title={`${t('menu.variant')} ${v.label}`}
          onClick={() => props.onPick(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function MenuHost(): React.JSX.Element {
  const [variant, setVariant] = useState<VariantId>(readVariant);
  const pick = (id: VariantId): void => {
    setVariant(id);
    try {
      localStorage.setItem(VARIANT_KEY, id);
    } catch {
      // Хранилище закрыто: вид меню живёт до закрытия вкладки.
    }
  };

  if (variant === 'classic') {
    return (
      <>
        <MainMenu />
        <div className={styles.top} style={{ position: 'fixed', zIndex: 10 }}>
          <Switcher current={variant} onPick={pick} />
        </div>
      </>
    );
  }
  return <NewMenu variant={variant} onPick={pick} />;
}

function NewMenu(props: {
  readonly variant: Exclude<VariantId, 'classic'>;
  readonly onPick: (id: VariantId) => void;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [settings, update] = useMenuSettings();
  const [shake, setShake] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState<boolean>(() => !wasAsked());
  const api = useMenuBackground(hostRef, settings.color);

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
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  const body = { settings, update, go, api };
  return (
    <main className={styles.page}>
      <div ref={hostRef} className={styles.background} aria-hidden="true" />
      {props.variant === 'cities' && <MenuCities {...body} />}
      {props.variant === 'cards' && <MenuCards {...body} />}
      {props.variant === 'dock' && <MenuDock {...body} />}
      <div className={styles.top}>
        <Switcher current={props.variant} onPick={props.onPick} />
        <p className={styles.brand}>Hexfront</p>
        <button
          type="button"
          className={styles.gear}
          aria-label={t('settings.title')}
          onClick={() => setSettingsOpen(true)}
        >
          <IconSettings size={22} aria-hidden="true" />
        </button>
      </div>
      <div className={variants.nickSlot}>
        <NickPlate settings={settings} update={update} shake={shake} />
      </div>
      {askOpen && (
        <div className={styles.backdrop}>
          <div className={styles.modal} role="dialog" aria-modal="true">
            <h1 className={classic.title}>{t('tutorial.askTitle')}</h1>
            <p className={classic.subtitle}>{t('tutorial.askText')}</p>
            <button
              type="button"
              className={classic.play}
              onClick={() => {
                markAsked();
                setAskOpen(false);
                go(tutorialUrl(settings.nickname, settings.color));
              }}
            >
              {t('tutorial.askYes')}
            </button>
            <button
              type="button"
              className={classic.tutorialButton}
              onClick={() => {
                markAsked();
                setAskOpen(false);
              }}
            >
              {t('tutorial.askNo')}
            </button>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className={styles.fullscreen}>
          <SettingsScreen onBack={() => setSettingsOpen(false)} />
        </div>
      )}
    </main>
  );
}
