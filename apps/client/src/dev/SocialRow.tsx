// Онлайн-связь в окне соседа: «Написать» — значок в заголовке рядом с закрытием, «Метка ▾» — кнопка
// в строке действий рядом с «Оборона» и «Наступать», как они: без рамки, значок и подпись.
import {
  IconAlertTriangle,
  IconHeartHandshake,
  IconMapPin,
  IconMessage,
  IconShield,
  IconSwords,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import type { MarkKind } from '@hexfront/protocol';

import splitStyles from './OrderSplit.module.css';
import styles from './SocialRow.module.css';
import { t } from '../i18n/dict.ts';
import { chatStore, useChat } from '../net/chat-store.ts';
import { IconButton } from '../ui/icon-button.tsx';

const MARKS = [
  { kind: 'attack', icon: IconSwords },
  { kind: 'defend', icon: IconShield },
  { kind: 'help', icon: IconHeartHandshake },
  { kind: 'look', icon: IconAlertTriangle },
] as const satisfies readonly { kind: MarkKind; icon: unknown }[];

/** Можно ли общаться с этим игроком: онлайн-матч, это живой человек и не я сам. */
function useCanTalk(other: number): boolean {
  const chat = useChat();
  return chat.sender !== null && other !== chat.sender.me && chat.humans?.has(other) === true;
}

/** Значок «Написать» в заголовке окна: открывает чат с адресатом. */
export function WriteButton(props: { readonly other: number }): React.JSX.Element | null {
  if (!useCanTalk(props.other)) return null;
  return (
    <IconButton
      label={t('chat.writeTo')}
      className={styles.write}
      onClick={() => chatStore.openTo(props.other)}
    >
      <IconMessage size={18} aria-hidden="true" />
    </IconButton>
  );
}

/** «Метка ▾»: короткий список видов метки; метку видят союзники, она рисуется на карте. */
export function MarkMenu(props: {
  readonly other: number;
  readonly hex: number;
}): React.JSX.Element | null {
  const canTalk = useCanTalk(props.other);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);
  if (!canTalk) return null;
  return (
    <div ref={ref} className={splitStyles.split}>
      <IconButton
        label={t('mark.title')}
        className={styles.write}
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        <IconMapPin size={18} aria-hidden="true" />
      </IconButton>
      {open && (
        <ul className={styles.marks} role="listbox" aria-label={t('mark.title')}>
          {MARKS.map(({ kind, icon: Icon }) => (
            <li key={kind}>
              <button
                type="button"
                className={styles.markItem}
                role="option"
                aria-selected={false}
                title={t(`mark.${kind}`)}
                aria-label={t(`mark.${kind}`)}
                onClick={() => {
                  setOpen(false);
                  chatStore.sendMark(props.hex, kind);
                }}
              >
                <Icon size={20} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Обе кнопки одной строкой — для видов окна, где нет отдельных мест под них. */
export function SocialRow(props: {
  readonly other: number;
  readonly hex: number;
}): React.JSX.Element | null {
  if (!useCanTalk(props.other)) return null;
  return (
    <div className={styles.row}>
      <WriteButton other={props.other} />
      <MarkMenu other={props.other} hex={props.hex} />
    </div>
  );
}
