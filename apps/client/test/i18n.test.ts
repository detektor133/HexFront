import { describe, expect, it } from 'vitest';

import { REJECT_REASONS } from '@hexfront/sim';

import { reasonText } from '../src/i18n/dict.ts';

describe('тексты интерфейса', () => {
  it('у каждой причины отказа sim есть текст', () => {
    const missing = REJECT_REASONS.filter((r) => reasonText(r).startsWith('reason.'));
    expect(missing).toEqual([]);
  });
});
