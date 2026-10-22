// Визуальный гейт: один раз перед push для UI-задач, снимок + review смотрит на картинку.
import { describe, expect, it } from 'vitest';

import { runWorld, type Session } from './test-world.ts';

const codeCommit = (path: string, answer = 'Код готов.'): Session => ({
  answer,
  writes: { [path]: 'export const x = 1;\n' },
  commit: true,
  push: false,
});
const review = (answer: string): Session => ({ answer, push: false });

describe('визуальный гейт перед push', () => {
  it('не запускается для задачи, не тронувшей клиентский UI', async () => {
    const run = await runWorld({
      sessions: [codeCommit('packages/sim/src/task.ts'), review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.visualCalls).toBe(0);
    expect(run.prompts).toHaveLength(2);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('снимает HUD и зовёт review один раз для задачи, тронувшей UI', async () => {
    const run = await runWorld({
      sessions: [codeCommit('apps/client/src/dev/Hud.module.css'), review('OK'), review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.visualCalls).toBe(1);
    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[2]).toContain('Визуальная проверка');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('дефект, найденный только на снимке, уходит обычным пунктом КОД исполнителю', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit('apps/client/src/dev/Hud.module.css'),
        review('OK'),
        review('ВОЗВРАТ\n- КОД: иконка людей сжата transform: scaleX(0.6), Hud.module.css:12'),
        codeCommit('apps/client/src/dev/Hud.module.css', 'Исправлено искажение.'),
        review('OK'),
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.visualCalls).toBe(2);
    const firstLines = run.prompts.map((prompt) => prompt.split('\n')[0]);
    expect(firstLines).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[2]).toContain('Визуальная проверка');
    expect(run.prompts[3]).toContain('иконка людей сжата');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });
});
