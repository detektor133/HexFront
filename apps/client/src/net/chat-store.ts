// Чат и метки онлайн-матча: общее хранилище вне React-дерева (сеть кладёт, интерфейс читает).
import { useSyncExternalStore } from 'react';

import type { MarkKind } from '@hexfront/protocol';

export interface ChatLine {
  readonly id: number;
  readonly from: number;
  readonly nick: string;
  readonly text?: string;
  readonly emoji?: number;
  /** Адресат личного сообщения. */
  readonly to?: number;
}

/** Что умеет отправлять сеть; `null` — матч не онлайн, чата нет. */
export interface ChatSender {
  readonly me: number;
  readonly chat: (message: { text?: string; emoji?: number; to?: number }) => void;
  readonly mark: (hex: number, kind: MarkKind) => void;
  /** «Ещё раз» после матча; нет — комната открытая, повтора нет. */
  readonly rematch?: () => void;
}

export interface ChatState {
  readonly sender: ChatSender | null;
  readonly lines: readonly ChatLine[];
  readonly unread: number;
  readonly open: boolean;
  /** Кому пишем: id игрока или `null` — всем. */
  readonly target: number | null;
}

/** Сколько последних сообщений хранится. */
const KEEP = 60;
const listeners = new Set<() => void>();

/** Метка союзника: рисуется на карте, в чат не попадает. */
export interface MarkEvent {
  readonly from: number;
  readonly hex: number;
  readonly kind: MarkKind;
}
const markListeners = new Set<(mark: MarkEvent) => void>();
let nextId = 1;
let state: ChatState = { sender: null, lines: [], unread: 0, open: false, target: null };

function set(patch: Partial<ChatState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function push(line: Omit<ChatLine, 'id'>): void {
  const lines = [...state.lines, { ...line, id: nextId++ }].slice(-KEEP);
  set({ lines, unread: state.open ? 0 : state.unread + 1 });
}

export const chatStore = {
  getState: (): ChatState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Матч стал онлайн (или закончился): чат включается и очищается. */
  setSender: (sender: ChatSender | null): void => {
    set({ sender, lines: [], unread: 0, open: false, target: null });
  },
  receive: (line: Omit<ChatLine, 'id'>): void => push(line),
  /** Пришла метка: слой карты подписан и рисует её. */
  receiveMark: (mark: MarkEvent): void => {
    for (const listener of markListeners) listener(mark);
  },
  onMark: (listener: (mark: MarkEvent) => void): (() => void) => {
    markListeners.add(listener);
    return () => {
      markListeners.delete(listener);
    };
  },
  toggle: (): void => set({ open: !state.open, unread: 0 }),
  /** Открыть чат с адресатом (кнопка «Написать» в окне соседа). */
  openTo: (target: number | null): void => set({ open: true, unread: 0, target }),
  setTarget: (target: number | null): void => set({ target }),
  sendText: (text: string): void => {
    const trimmed = text.trim();
    if (trimmed === '' || state.sender === null) return;
    state.sender.chat({ text: trimmed, ...(state.target === null ? {} : { to: state.target }) });
  },
  sendEmoji: (emoji: number): void => {
    state.sender?.chat({ emoji, ...(state.target === null ? {} : { to: state.target }) });
  },
  sendMark: (hex: number, kind: MarkKind): void => state.sender?.mark(hex, kind),
};

/** Состояние чата для компонента. */
export function useChat(): ChatState {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getState, chatStore.getState);
}
