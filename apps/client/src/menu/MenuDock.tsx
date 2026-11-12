// Док: «Онлайн» и «Против ботов» по краям, посередине «Быстрый бой». Панель режима открывается над
// доком окном-«телевизором».
import { useEffect, useRef, useState } from 'react';

import { GlobeIcon, RobotIcon, SwordsIcon } from './DockIcons.tsx';
import { ModePanel, modeName, type ModeId } from './MenuParts.tsx';
import type { MenuSettings } from './menu-config.ts';
import styles from './menu-dock.module.css';
import ui from './menu-ui.module.css';
import { t } from '../i18n/dict.ts';
import { useTvPresence } from '../ui/use-tv-presence.ts';

/** Через сколько после нажатия «Быстрый бой» открывается поиск: хватает на удар мечей. */
const CLASH_MS = 420;

export function MenuDock(props: {
  readonly settings: MenuSettings;
  readonly update: (patch: Partial<MenuSettings>) => void;
  readonly go: (url: string) => void;
  readonly mode: ModeId | null;
  readonly onMode: (mode: ModeId | null) => void;
}): React.JSX.Element {
  const presence = useTvPresence(props.mode !== null);
  // Кнопка боя: мечи делают один удар, и сразу после него открывается поиск матча.
  const [clash, setClash] = useState(false);
  const clashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clashTimer.current !== null) clearTimeout(clashTimer.current);
    },
    [],
  );
  const fight = (): void => {
    setClash(true);
    clashTimer.current = setTimeout(() => {
      setClash(false);
      props.go('/online');
    }, CLASH_MS);
  };
  // Пока панель закрывается, режим уже сброшен: рисуем последний, чтобы не мигало пустым окном.
  const shown = useRef<ModeId>('online');
  if (props.mode !== null) shown.current = props.mode;
  const tab = (id: ModeId, icon: React.ReactNode): React.JSX.Element => (
    <button
      type="button"
      className={`${styles.tab} ${props.mode === id ? styles.on : ''}`}
      aria-pressed={props.mode === id}
      onClick={() => props.onMode(props.mode === id ? null : id)}
    >
      {icon}
      {modeName(id)}
    </button>
  );
  return (
    <>
      {presence.mounted && (
        <div className={ui.panelSlot}>
          <ModePanel
            mode={shown.current}
            settings={props.settings}
            update={props.update}
            go={props.go}
            onBack={() => props.onMode(null)}
            className={presence.className}
          />
        </div>
      )}
      <div className={styles.dock}>
        <div className={styles.bar}>
          {tab('online', <GlobeIcon />)}
          <button
            type="button"
            className={`${styles.go} ${clash ? styles.clash : ''}`}
            onClick={fight}
          >
            <SwordsIcon size={46} />
            {t('menu.quick')}
          </button>
          {tab('bots', <RobotIcon />)}
        </div>
      </div>
    </>
  );
}
