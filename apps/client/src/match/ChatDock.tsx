// Чат онлайн-матча: кнопка в колонке инструментов карты и панель сообщений. Быстрые реакции — значки,
// личное сообщение — выбор адресата или кнопка «Написать» в окне соседа.
import {
  IconAlertTriangle,
  IconHeartHandshake,
  IconMessage,
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
import { IconButton } from '../ui/icon-button.tsx';

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

/** Кнопка чата для колонки инструментов: точка — есть непрочитанное. */
export function ChatToggle(): React.JSX.Element | null {
  const chat = useChat();
  if (chat.sender === null) return null;
  return (
    <IconButton
      label={chat.open ? t('chat.close') : t('chat.open')}
      className={chat.open ? styles.toggleOn : styles.toggle}
      aria-pressed={chat.open}
      onClick={chatStore.toggle}
    >
      <IconMessage size={22} stroke={1.75} />
      {chat.unread > 0 && <span className={styles.badge}>{Math.min(chat.unread, 9)}</span>}
    </IconButton>
  );
}

/** Панель чата слева от колонки инструментов. */
export function ChatPanel(props: {
  readonly players: readonly { readonly id: number; readonly name: string }[];
  readonly bottom: number;
}): React.JSX.Element | null {
  const chat = useChat();
  const [text, setText] = useState('');
  const end = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat.lines.length, chat.open]);
  if (chat.sender === null || !chat.open) return null;
  const me = chat.sender.me;
  const submit = (): void => {
    chatStore.sendText(text);
    setText('');
  };
  return (
    <section className={styles.panel} style={{ bottom: props.bottom }} aria-label={t('chat.title')}>
      <header className={styles.head}>
        <b>{t('chat.title')}</b>
        <select
          className={styles.to}
          aria-label={t('chat.to')}
          value={chat.target ?? ''}
          onChange={(event) =>
            chatStore.setTarget(event.target.value === '' ? null : Number(event.target.value))
          }
        >
          <option value="">{t('chat.all')}</option>
          {props.players
            .filter((player) => player.id !== me)
            .map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          className={styles.close}
          aria-label={t('chat.close')}
          onClick={chatStore.toggle}
        >
          <IconX size={18} aria-hidden="true" />
        </button>
      </header>
      <ul className={styles.log}>
        {chat.lines.map((line) => (
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
            <Icon size={18} aria-hidden="true" />
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
          <IconSend size={18} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
