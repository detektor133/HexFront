// Чат онлайн-матча: кнопка в колонке инструментов (MapTools) и окно слева от неё. Быстрые реакции — значки,
// личное сообщение — кнопка «Написать» в окне соседа.
import {
  IconAlertTriangle,
  IconHeartHandshake,
  IconMoodSad,
  IconMoodSmile,
  IconSend,
  IconShield,
  IconSwords,
  IconThumbDown,
  IconThumbUp,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import styles from './ChatDock.module.css';
import { t } from '../i18n/dict.ts';
import { chatStore, useChat, type ChatLine } from '../net/chat-store.ts';
import { tokens } from '../theme/tokens.ts';

/** Быстрые реакции: номер в сообщении — индекс здесь (значки, не эмодзи — правило стиля). */
export const REACTIONS = [
  IconThumbUp,
  IconThumbDown,
  IconMoodSmile,
  IconMoodSad,
  IconSwords,
  IconShield,
  IconHeartHandshake,
  IconAlertTriangle,
] as const;

const color = (id: number): string => tokens.players.palette[id]?.line ?? tokens.ui.ink;

function Line(props: { readonly line: ChatLine; readonly me: number }): React.JSX.Element {
  const { line } = props;
  const Reaction = line.emoji === undefined ? null : REACTIONS[line.emoji];
  return (
    <li className={styles.line}>
      <b style={{ color: color(line.from) }}>
        {line.from === props.me ? t('vote.you') : line.nick}
      </b>
      {line.to !== undefined && <small>{` · ${t('chat.private')}`}</small>}
      <span className={styles.body}>
        {Reaction !== null && Reaction !== undefined && <Reaction size={18} aria-hidden="true" />}
        {line.text}
      </span>
    </li>
  );
}

/** Сколько последних сообщений видно в ленте и сколько мс висит новое при свёрнутом чате. */
const SHOWN = 6;
const TOAST_MS = 6000;

/** Лента, ввод и быстрые реакции: окно слева от колонки инструментов, внутри её контейнера. */
export function ChatPanel(props: {
  readonly players: readonly { readonly id: number; readonly name: string }[];
  /** Отступ от нижнего края экрана, px: на уровне нижней кромки колонки инструментов. */
  readonly bottom?: number;
}): React.JSX.Element | null {
  const chat = useChat();
  const [text, setText] = useState('');
  const end = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat.lines.length, chat.open]);
  // Свёрнутый чат не молчит: новое сообщение появляется строкой на несколько секунд.
  const last = chat.lines.at(-1);
  const [toastId, setToastId] = useState<number | null>(null);
  useEffect(() => {
    if (chat.open || last === undefined) return;
    setToastId(last.id);
    const timer = setTimeout(() => setToastId(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [last?.id, chat.open]);
  if (chat.sender === null) return null;
  const dockStyle = { '--chat-bottom': `${props.bottom ?? 16}px` } as React.CSSProperties;
  const me = chat.sender.me;
  if (!chat.open) {
    return last !== undefined && toastId === last.id ? (
      <div className={styles.dock} style={dockStyle}>
        <ul className={styles.toast} aria-live="polite">
          <Line line={last} me={me} />
        </ul>
      </div>
    ) : null;
  }
  const target = props.players.find((player) => player.id === chat.target);
  const submit = (): void => {
    chatStore.sendText(text);
    setText('');
  };
  return (
    <div className={styles.dock} style={dockStyle}>
      <section className={styles.panel} aria-label={t('chat.title')}>
        <header className={styles.head}>
          <h2 className={styles.title}>{t('chat.title')}</h2>
          <button
            type="button"
            className={styles.close}
            aria-label={t('menu.close')}
            onClick={() => chatStore.toggle()}
          >
            <IconX size={18} aria-hidden="true" />
          </button>
        </header>
        <ul className={styles.log}>
          {chat.lines.length === 0 && <li className={styles.empty}>{t('chat.empty')}</li>}
          {chat.lines.slice(-SHOWN).map((line) => (
            <Line key={line.id} line={line} me={me} />
          ))}
          <li ref={end} aria-hidden="true" />
        </ul>
        <div className={styles.reactions} role="group" aria-label={t('chat.emoji')}>
          {REACTIONS.map((Icon, index) => (
            <button
              key={index}
              type="button"
              className={styles.reaction}
              onClick={() => chatStore.sendEmoji(index)}
            >
              <Icon size={20} aria-hidden="true" />
            </button>
          ))}
        </div>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {target !== undefined && (
            <button
              type="button"
              className={styles.target}
              title={t('chat.all')}
              onClick={() => chatStore.setTarget(null)}
            >
              <span>{target.name}</span>
              <IconX size={16} aria-hidden="true" />
            </button>
          )}
          <input
            className={styles.input}
            value={text}
            maxLength={140}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <button type="submit" className={styles.send} aria-label={t('chat.send')}>
            <IconSend size={20} aria-hidden="true" />
          </button>
        </form>
      </section>
    </div>
  );
}
