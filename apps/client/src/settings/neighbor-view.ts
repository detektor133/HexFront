// Вид окна соседа (дипломатия в меню страны), хранится в браузере: пока выбираем лучший из трёх.
import { useEffect, useState } from 'react';

export const NEIGHBOR_VIEWS = ['icons', 'card', 'ladder'] as const;
export type NeighborView = (typeof NEIGHBOR_VIEWS)[number];

const KEY = 'hexfront.neighborView';
export const DEFAULT_NEIGHBOR_VIEW: NeighborView = 'card';
const listeners = new Set<() => void>();
let memory: NeighborView | null = null;

/** Сохранённый вид окна соседа или вид по умолчанию. */
export function readNeighborView(): NeighborView {
  if (memory !== null) return memory;
  try {
    const saved = localStorage.getItem(KEY);
    return NEIGHBOR_VIEWS.find((view) => view === saved) ?? DEFAULT_NEIGHBOR_VIEW;
  } catch {
    return DEFAULT_NEIGHBOR_VIEW;
  }
}

/** Запоминает вид и оповещает подписчиков: настройки и окно соседа видят одно значение. */
export function writeNeighborView(view: NeighborView): void {
  try {
    localStorage.setItem(KEY, view);
    memory = null;
  } catch {
    // Хранилище закрыто: выбор действует до перезагрузки страницы.
    memory = view;
  }
  for (const listener of listeners) listener();
}

/** Вид окна соседа и его запись; компонент перерисовывается при смене. */
export function useNeighborView(): readonly [NeighborView, (view: NeighborView) => void] {
  const [value, setValue] = useState<NeighborView>(readNeighborView);
  useEffect(() => {
    const listener = (): void => setValue(readNeighborView());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return [value, writeNeighborView];
}
