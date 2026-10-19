import { describe, expect, it } from 'vitest';

import { lastReturnItems, touchedPaths, withReviewFeedback } from './return-guard.ts';
import { runWorld, type Session } from './test-world.ts';

describe('передача возврата reviewer', () => {
  it('берёт пункты последнего блока независимо от markdown-отступа', () => {
    const block = [
      '- [ ] **T1. X**',
      '  Возврат ревью:',
      '  - старый.ts:1 — прошлый круг',
      'Возврат ревью:',
      '- СПЕК: x.test.ts:3 — нет проверки',
      '*Приёмка:* тест.',
    ].join('\n');
    expect(lastReturnItems(block)).toEqual(['СПЕК: x.test.ts:3 — нет проверки']);
  });

  it('читает пути diff, включая обе стороны переименования', () => {
    expect(touchedPaths(`M\ta.ts\nR090\told.ts\tnew.ts\nD\tgone.ts\n`)).toEqual([
      'a.ts',
      'old.ts',
      'new.ts',
      'gone.ts',
    ]);
  });

  it('передаёт возврат дословно, но не требует отчёта специального формата', () => {
    const feedback = 'ВОЗВРАТ\n- СПЕК: x.test.ts:3 — нет проверки';
    const prompt = withReviewFeedback('$next', '07/T1', feedback);
    expect(prompt).toContain(feedback);
    expect(prompt).toContain('оркестратор не разбирает его текст');
    expect(prompt).not.toContain('ИСПРАВЛЕНО ПО РЕВЬЮ');
  });

  it('после возврата отправляет любой чистый коммит на повторное review', async () => {
    const work: Session = { task: 'T1j5-Б1', mark: '~', answer: 'Готово.' };
    const back: Session = {
      task: 'T1j5-Б1',
      mark: ' ',
      answer: 'ВОЗВРАТ\n- apps/client/test/x.test.ts:3 — нет проверки',
    };
    const ok: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK' };
    const run = await runWorld({ sessions: [work, back, work, ok] });

    expect(run.prompts).toHaveLength(4);
    expect(run.prompts[2]).toContain('apps/client/test/x.test.ts:3 — нет проверки');
    expect(run.prompts[3]).toBe('$review 06/T1j5-Б1');
    expect(run.lines.join('\n')).not.toContain('файлы пунктов возврата не тронуты');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });
});
