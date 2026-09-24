import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import * as balance from '../../src/balance.ts';

const DOC = new URL('../../../../docs/gdd/10-balance.md', import.meta.url);

describe('balance.ts и 10-balance.md', () => {
  it('каждая константа из документа экспортируется из balance.ts', async () => {
    const doc = await readFile(DOC, 'utf8');
    const names = [...doc.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1] ?? '');
    const missing = [...new Set(names)].filter((n) => !(n in balance));
    expect(missing).toEqual([]);
  });
});
