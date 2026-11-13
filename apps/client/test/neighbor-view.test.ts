// Окно соседа: вид сохраняется в браузере; значения вне списка (старые «карточка» и «ступени»)
// заменяются видом по умолчанию.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NEIGHBOR_VIEW,
  NEIGHBOR_VIEWS,
  readNeighborView,
  writeNeighborView,
} from '../src/settings/neighbor-view.ts';

describe('вид окна соседа', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    writeNeighborView(DEFAULT_NEIGHBOR_VIEW);
  });

  it('значки — прежний вид, ещё четыре новых; по умолчанию — «фокус»', () => {
    expect(NEIGHBOR_VIEWS).toEqual(['icons', 'list', 'focus', 'tiles', 'tabs']);
    expect(readNeighborView()).toBe('focus');
  });

  it('выбор запоминается', () => {
    writeNeighborView('tiles');
    expect(readNeighborView()).toBe('tiles');
    expect(store.get('hexfront.neighborView')).toBe('tiles');
  });

  it('снятый вид из старого хранилища заменяется видом по умолчанию', () => {
    store.set('hexfront.neighborView', 'ladder');
    expect(readNeighborView()).toBe(DEFAULT_NEIGHBOR_VIEW);
  });
});
