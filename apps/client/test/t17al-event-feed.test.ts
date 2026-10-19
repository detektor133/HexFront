import { describe, expect, it } from 'vitest';

import type { GameEvent } from '@hexfront/sim';

import { eventLabel } from '../src/dev/EventFeed.tsx';
import { messages } from '../src/i18n/dict.ts';

const EVENT_TYPES: readonly GameEvent['t'][] = [
  'commandRejected',
  'unitRecruited',
  'recruitCancelled',
  'unitDestroyed',
  'unitRetreated',
  'unitCapitulated',
  'cityCaptured',
  'capitalMoved',
  'playerEliminated',
  'offensiveDone',
  'matchWon',
  'constructionDone',
  'constructionCancelled',
];

describe('T17al: переводы и метки ленты событий', () => {
  it('переводит каждый тип события в обоих словарях', () => {
    for (const eventType of EVENT_TYPES) {
      const key = eventLabel(eventType);
      expect(messages.ru[key], key).toBeTruthy();
      expect(messages.en[key], key).toBeTruthy();
    }
  });

  it('возвращает только ключи событий', () => {
    for (const eventType of EVENT_TYPES) {
      expect(eventLabel(eventType)).toBe(`event.${eventType}`);
    }
  });
});
