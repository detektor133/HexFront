// Чат онлайн-матча: кнопка в колонке инструментов (MapTools) и окно слева от неё. Быстрые реакции — значки,
// личное сообщение — кнопка «Написать» в окне соседа.
import {
  IconAlertTriangle,
  IconArrowsDiagonal2,
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

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Gesture {
  readonly kind: 'move' | 'resize';
  readonly px: number;
  readonly py: number;
  readonly from: Rect;
}

interface Viewport {
  readonly w: number;
  readonly h: number;
  /** Верх видимой области, px: сдвигается, когда экранная клавиатура поднимает страницу. */
  readonly top: number;
}

/** Где пользователь оставил окно чата; живёт, пока открыта страница, чтобы чат не прыгал при закрытии. */
let savedRect: Rect | null = null;

const EDGE = 8;
const MIN_W = 240;
const MIN_H = 190;
/** Справа от окна на ПК остаётся колонка инструментов, на телефоне — ручка её выдвижной панели. */
const TOOLS_GAP_WIDE = 96;
const TOOLS_GAP_NARROW = 32;

function readViewport(): Viewport {
  const v = window.visualViewport;
  return { w: window.innerWidth, h: v?.height ?? window.innerHeight, top: v?.offsetTop ?? 0 };
}

/** Видимая область окна; пересчитывается, когда появляется клавиатура или меняется размер. */
function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(readViewport);
  useEffect(() => {
    const update = (): void => setVp(readViewport());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
  return vp;
}

/** Исходное место: над нижней кромкой колонки инструментов, слева от неё. */
function defaultRect(vp: Viewport, bottom: number): Rect {
  const gap = vp.w <= 640 ? TOOLS_GAP_NARROW : TOOLS_GAP_WIDE;
  const w = Math.min(360, vp.w - gap - EDGE);
  const h = Math.min(340, Math.round(vp.h * 0.55));
  return { x: vp.w - gap - w, y: vp.top + vp.h - bottom - h, w, h };
}

/** Окно целиком в видимой области: за край и под клавиатуру не уходит. */
function fitRect(r: Rect, vp: Viewport): Rect {
  const w = Math.max(Math.min(MIN_W, vp.w - 2 * EDGE), Math.min(r.w, vp.w - 2 * EDGE));
  const h = Math.max(Math.min(MIN_H, vp.h - 2 * EDGE), Math.min(r.h, vp.h - 2 * EDGE));
  const x = Math.max(EDGE, Math.min(r.x, vp.w - w - EDGE));
  const y = Math.max(vp.top + EDGE, Math.min(r.y, vp.top + vp.h - h - EDGE));
  return { x, y, w, h };
}

/** Сколько последних сообщений видно в ленте и сколько мс висит новое при свёрнутом чате. */
const SHOWN = 30;
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
  const vp = useViewport();
  const [moved, setMoved] = useState<Rect | null>(savedRect);
  const gesture = useRef<Gesture | null>(null);
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
  const rect = fitRect(moved ?? defaultRect(vp, props.bottom ?? 16), vp);
  const start = (kind: Gesture['kind']) => (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button') !== null && kind === 'move') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, px: event.clientX, py: event.clientY, from: rect };
  };
  const drag = (event: React.PointerEvent<HTMLElement>): void => {
    const g = gesture.current;
    if (g === null) return;
    const dx = event.clientX - g.px;
    const dy = event.clientY - g.py;
    setMoved(
      fitRect(
        g.kind === 'move'
          ? { ...g.from, x: g.from.x + dx, y: g.from.y + dy }
          : { ...g.from, w: g.from.w + dx, h: g.from.h + dy },
        vp,
      ),
    );
  };
  const drop = (): void => {
    gesture.current = null;
    savedRect = moved;
  };
  const place = {
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
  } as React.CSSProperties;
  return (
    <div className={styles.floating} style={place}>
      <section className={styles.panel} aria-label={t('chat.title')}>
        <header
          className={styles.head}
          onPointerDown={start('move')}
          onPointerMove={drag}
          onPointerUp={drop}
          onPointerCancel={drop}
        >
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
        <span
          className={styles.grip}
          role="separator"
          aria-label={t('chat.resize')}
          onPointerDown={start('resize')}
          onPointerMove={drag}
          onPointerUp={drop}
          onPointerCancel={drop}
        >
          <IconArrowsDiagonal2 size={16} aria-hidden="true" />
        </span>
      </section>
    </div>
  );
}
