import { describe, expect, it } from 'vitest';

import { MAX_ARMY_NAME_LENGTH, normalizeArmyName } from '../src/dev/army-name.ts';

describe('имя армии', () => {
  it('ограничивает имя двадцатью символами', () => {
    expect(normalizeArmyName('123456789012345678901')).toHaveLength(MAX_ARMY_NAME_LENGTH);
  });

  it('пустое имя возвращает значение для нумерованной армии', () => {
    expect(normalizeArmyName('   ')).toBe('');
  });
});
