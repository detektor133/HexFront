// Вид «Док»: чистая живая карта, внизу панель режимов и большая кнопка «В бой».
import { IconRobot, IconSchool, IconSwords, IconUsers, IconWorld } from '@tabler/icons-react';
import { useState } from 'react';

import { ModePanel } from './MenuParts.tsx';
import styles from './menu-variants.module.css';
import { modeName, type ModeId } from './mode-items.ts';
import type { VariantProps } from './variant-props.ts';
import { t } from '../i18n/dict.ts';

export function MenuDock(props: VariantProps): React.JSX.Element {
  const [mode, setMode] = useState<ModeId | null>(null);
  const tab = (id: ModeId, label: string, icon: React.ReactNode): React.JSX.Element => (
    <button
      type="button"
      className={`${styles.dockTab} ${mode === id ? styles.on : ''}`}
      aria-pressed={mode === id}
      onClick={() => setMode(mode === id ? null : id)}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <>
      {mode !== null && (
        <div className={styles.dockPanel}>
          <ModePanel
            mode={mode}
            settings={props.settings}
            update={props.update}
            go={props.go}
            onBack={() => setMode(null)}
          />
        </div>
      )}
      <div className={styles.dock}>
        <div className={styles.dockBar}>
          {tab('online', modeName('online'), <IconWorld size={24} aria-hidden="true" />)}
          {tab('bots', modeName('bots'), <IconRobot size={24} aria-hidden="true" />)}
          <button type="button" className={styles.go} onClick={() => props.go('/online')}>
            <IconSwords size={30} aria-hidden="true" />
            {t('menu.quick')}
          </button>
          {tab('tutorial', modeName('tutorial'), <IconSchool size={24} aria-hidden="true" />)}
          {tab('online', t('menu.friends'), <IconUsers size={24} aria-hidden="true" />)}
        </div>
      </div>
    </>
  );
}
