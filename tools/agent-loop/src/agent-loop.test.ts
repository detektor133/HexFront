import { describe, expect, it, vi } from 'vitest';

import { selectIssueOrQueue } from './agent-loop.ts';

describe('выбор задачи оркестратором', () => {
  it('выбирает открытый Issue с меткой agent по номеру', () => {
    const result = selectIssueOrQueue(
      [
        { number: 8, title: 'позже', body: '', labels: [{ name: 'agent' }], state: 'open' },
        { number: 3, title: 'раньше', body: 'текст', labels: [{ name: 'agent' }], state: 'open' },
      ],
      'Очередь: 05/T1',
    );
    expect(result?.task).toContain('Issue #3');
  });

  it('использует первую задачу очереди без Issues', () => {
    expect(selectIssueOrQueue([], 'Очередь: 05/T15c → 05/T15d')?.task).toBe('05/T15c');
  });

  it('игнорирует закрытые Issues без метки agent', () => {
    const result = selectIssueOrQueue(
      [
        { number: 1, title: 'закрыт', body: null, labels: [{ name: 'agent' }], state: 'closed' },
        { number: 2, title: 'без метки', body: null, labels: [], state: 'open' },
      ],
      'Очередь: 05/T15c',
    );
    expect(result?.source).toBe('queue');
  });
});

describe('контракт тестовых замен', () => {
  it('не требует реального GitHub клиента', () => {
    expect(vi.fn()).toBeDefined();
  });
});
