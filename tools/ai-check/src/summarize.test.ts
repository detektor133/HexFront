import { describe, expect, it } from 'vitest';

import { summarizeVitest, trimStack } from './summarize.ts';

describe('trimStack', () => {
  it('обрезает до max строк и убирает пустые строки и node_modules', () => {
    const text = ['a', '', 'at x (node_modules/y.js:1)', 'b', 'c', 'd'].join('\n');
    expect(trimStack(text, 3)).toBe('a\nb\nc');
  });
});

describe('summarizeVitest', () => {
  it('ничего не выводит для зелёного отчёта', () => {
    const report = {
      testResults: [
        {
          name: '/r/packages/sim/a.test.ts',
          assertionResults: [{ fullName: 'ok', status: 'passed' }],
        },
      ],
    };
    expect(summarizeVitest(report, 10)).toEqual([]);
  });

  it('для упавшего теста даёт заголовок и обрезанное сообщение', () => {
    const report = {
      testResults: [
        {
          name: 'C:\\r\\packages\\sim\\a.test.ts',
          assertionResults: [
            {
              fullName: 'группа > случай',
              status: 'failed',
              failureMessages: ['ожидали 1\nполучили 2\nстек1\nстек2'],
            },
            { fullName: 'другой', status: 'passed' },
          ],
        },
      ],
    };
    expect(summarizeVitest(report, 2)).toEqual([
      'FAIL packages/sim/a.test.ts > группа > случай',
      '  ожидали 1',
      '  получили 2',
    ]);
  });

  it('файл, не сумевший запуститься, помечается отдельно', () => {
    const report = {
      testResults: [
        { name: '/r/tools/x.test.ts', message: 'SyntaxError: boom', assertionResults: [] },
      ],
    };
    expect(summarizeVitest(report, 10)[0]).toBe('FAIL tools/x.test.ts (файл не запустился)');
  });
});
