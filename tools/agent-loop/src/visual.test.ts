// Визуальный гейт: один раз перед push для UI-задач, снимок прикладывается как изображение
// (`codex exec -i`), а не путём в тексте — иначе review честно не может его посмотреть.
import { describe, expect, it } from 'vitest';

import { fixtureStage, runWorld, type Session } from './test-world.ts';

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

  it('снимает HUD и прикладывает снимки как изображения review, а не путём в тексте', async () => {
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
    expect(run.prompts[2]).toContain('Приложены');
    expect(run.prompts[2]).toContain('Критерий этой задачи:');
    expect(run.prompts[2]).toContain('Изменённые файлы UI этой задачи:');
    expect(run.prompts[2]).toContain('apps/client/src/dev/Hud.module.css');
    expect(run.prompts[2]).toContain('Замечания к другим элементам карты не возвращай');
    expect(run.prompts[2]).not.toMatch(/hud-360\.png/u);
    const visualArgs = run.codexArguments[2] ?? [];
    expect(visualArgs).toContain('-i');
    const imageIndex = visualArgs.indexOf('-i');
    expect(visualArgs.slice(imageIndex + 1, imageIndex + 4)).toEqual([
      expect.stringContaining('hud-360.png'),
      expect.stringContaining('hud-1024.png'),
      expect.stringContaining('hud-1920.png'),
    ]);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('передаёт reviewer снимок из состояния @layout-сценария перед общим HUD', async () => {
    const run = await runWorld({
      sessions: [
        {
          answer: 'Код и сценарий готовы.',
          writes: {
            'apps/client/src/dev/Hud.module.css': '.hud { display: block; }',
            'apps/client/tests/e2e/task-layout.spec.ts': "test('@layout состояние HUD', () => {});",
          },
          commit: true,
        },
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.visualCalls).toBe(1);
    expect(run.layoutCalls).toBeGreaterThan(0);
    const prompt = run.prompts[2] ?? '';
    expect(prompt).toContain('task-layout.spec.ts');
    expect(prompt).toContain('сначала 1 из @layout-сценария');
    const visualArgs = run.codexArguments[2] ?? [];
    const imageIndex = visualArgs.indexOf('-i');
    expect(visualArgs[imageIndex + 1]).toContain('test-finished-1.png');
    expect(visualArgs[imageIndex + 2]).toContain('hud-360.png');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('при обязательном @layout без сценария возвращает TEST исполнителю', async () => {
    const run = await runWorld({
      stage: fixtureStage.replace('*Приёмка:* тесты.', '*Приёмка:* Playwright @layout.'),
      sessions: [
        codeCommit('apps/client/src/dev/Hud.module.css'),
        review('OK'),
        {
          answer: 'Добавлен сценарий состояния.',
          writes: {
            'apps/client/tests/e2e/task-layout.spec.ts': "test('@layout состояние HUD', () => {});",
          },
          commit: true,
        },
        review('OK'),
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[2]).toContain('в задаче требуется @layout, но её сценарий не добавлен');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('дефект, найденный только на снимке, уходит обычным пунктом КОД исполнителю', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit('apps/client/src/dev/Hud.module.css'),
        review('OK'),
        review(
          'ВОЗВРАТ\n- КОД: apps/client/src/dev/Hud.module.css: иконка людей сжата transform: scaleX(0.6), 360 px',
        ),
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
    expect(run.prompts[2]).toContain('Приложены');
    expect(run.prompts[3]).toContain('иконка людей сжата');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('пропускает замечание к чужому элементу карты и завершает задачу', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit('apps/client/src/dev/Hud.module.css'),
        review('OK'),
        review('ВОЗВРАТ\n- КОД: apps/client/src/render/unit-chips.ts: метки налезают, 360 px'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.visualCalls).toBe(1);
    expect(run.prompts).toHaveLength(3);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
    expect(run.lines.some((line) => line.includes('вне изменённого UI пропущено'))).toBe(true);
  });
});
