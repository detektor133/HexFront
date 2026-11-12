// Окно соседа: вид сохраняется в браузере, лестница отношений ведёт ступень выше предложением,
// ступень ниже — разрывом или войной.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { stepCommand } from '../src/dev/DiplomacyBlock.tsx';
import {
  DEFAULT_NEIGHBOR_VIEW,
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

  it('по умолчанию — карточка; выбор запоминается', () => {
    expect(readNeighborView()).toBe('card');
    writeNeighborView('ladder');
    expect(readNeighborView()).toBe('ladder');
    expect(store.get('hexfront.neighborView')).toBe('ladder');
  });
});

describe('лестница отношений', () => {
  it('из войны можно только предложить мир', () => {
    expect(stepCommand('war', 'peace', 3)).toEqual({
      t: 'proposeTreaty',
      target: 3,
      kind: 'peace',
    });
    expect(stepCommand('war', 'pact', 3)).toBeNull();
    expect(stepCommand('war', 'war', 3)).toBeNull();
  });

  it('из мира вверх — предложение любого договора, вниз — война', () => {
    expect(stepCommand('peace', 'alliance', 3)).toEqual({
      t: 'proposeTreaty',
      target: 3,
      kind: 'alliance',
    });
    expect(stepCommand('peace', 'war', 3)).toEqual({ t: 'declareWar', target: 3 });
  });

  it('из договора вниз — разрыв в мир, на соседнюю ступень вниз не спускаются', () => {
    expect(stepCommand('alliance', 'peace', 3)).toEqual({ t: 'breakTreaty', target: 3 });
    expect(stepCommand('alliance', 'pact', 3)).toBeNull();
    expect(stepCommand('pact', 'defense', 3)).toEqual({
      t: 'proposeTreaty',
      target: 3,
      kind: 'defense',
    });
  });
});
