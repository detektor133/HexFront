// Онлайн-связь в окне соседа: написать ему лично и поставить метку на этой земле для союзников.
import { IconAlertTriangle, IconMessage, IconShield, IconSwords } from '@tabler/icons-react';

import styles from './SocialRow.module.css';
import { t } from '../i18n/dict.ts';
import { chatStore, useChat } from '../net/chat-store.ts';

const MARKS = [
  { kind: 'attack', icon: IconSwords },
  { kind: 'defend', icon: IconShield },
  { kind: 'look', icon: IconAlertTriangle },
] as const;

/** Пусто вне онлайн-матча. */
export function SocialRow(props: {
  readonly other: number;
  readonly hex: number;
}): React.JSX.Element | null {
  const chat = useChat();
  if (chat.sender === null || props.other === chat.sender.me) return null;
  return (
    <div className={styles.row} role="group" aria-label={t('mark.title')}>
      <button type="button" className={styles.write} onClick={() => chatStore.openTo(props.other)}>
        <IconMessage size={18} aria-hidden="true" />
        <span>{t('chat.writeTo')}</span>
      </button>
      {MARKS.map(({ kind, icon: Icon }) => (
        <button
          key={kind}
          type="button"
          className={styles.mark}
          title={t(`mark.${kind}`)}
          aria-label={t(`mark.${kind}`)}
          onClick={() => chatStore.sendMark(props.hex, kind)}
        >
          <Icon size={18} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
