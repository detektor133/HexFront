import { describe, expect, it } from 'vitest';

import { clearInterruptedBackoff, defaultRunCommand } from './agent-loop.ts';
import {
  closedStageBranch,
  commandTask,
  isOwnerTask,
  missingQueueTasks,
  parseQueue,
  selectTask,
  taskMark,
} from './stage-file.ts';
import type { LoopState } from './state.ts';
import { fixtureStage, fixtureStatus, setMark } from './test-world.ts';

describe('разбор файла этапа', () => {
  it('выбирает первую незакрытую задачу очереди, включая старую отметку [~]', () => {
    expect(selectTask(fixtureStatus, fixtureStage)).toBe('06/T1j5-Б1');
    expect(selectTask(fixtureStatus, setMark(fixtureStage, 'T1j5-Б1', 'x'))).toBe('06/T1i');
    expect(selectTask(fixtureStatus, setMark(fixtureStage, 'T1j5-Б1', '~'))).toBe('06/T1j5-Б1');
  });

  it('берёт из очереди только номера задач', () => {
    expect(parseQueue('Очередь: 07/T1 после мержа PR этапа 06; новый этап не начат.')).toEqual([
      '07/T1',
    ]);
    expect(parseQueue('Очередь: 06/T1j7 → 06/T1i → 06/T1e → 06/T2')).toHaveLength(4);
  });

  it('не путает родительскую задачу с дочерними', () => {
    const stage = setMark(fixtureStage, 'T1i', 'x');
    expect(taskMark(stage, '06/T1')).toBe(' ');
    expect(taskMark(stage, '06/T1i')).toBe('x');
    expect(taskMark(stage, '06/T9')).toBeUndefined();
  });

  it('не принимает объединённый заголовок за отдельные задачи очереди', () => {
    const status = 'Очередь: 07/T17awa → 07/T17awb → 07/T17ax';
    const stage = '- [x] **T17awa–T17awb. HUD**\n- [ ] **T17ax. Бой**\n';

    expect(missingQueueTasks(status, stage)).toEqual(['07/T17awa', '07/T17awb']);
  });

  it('определяет задачу владельца только по заголовку', () => {
    expect(isOwnerTask('- [ ] **T1i. Обучение весов**, задача владельца.')).toBe(true);
    expect(isOwnerTask('- [ ] **T8. Плейтест**')).toBe(true);
    expect(isOwnerTask('- [ ] **T1e. Проверка**, не задача владельца.')).toBe(false);
  });

  it('разбирает команды split и accept из ответа', () => {
    expect(commandTask('запусти `$split 06/T1j5-Б1`.', '$split')).toBe('06/T1j5-Б1');
    expect(commandTask('нужен $accept 06/T1.', '$accept')).toBe('06/T1');
    expect(commandTask('нужен $accept', '$accept')).toBeUndefined();
  });

  it('видит закрытый этап по смене текущего этапа', () => {
    expect(closedStageBranch(fixtureStatus)).toBeUndefined();
    expect(closedStageBranch(fixtureStatus.replace('| 06 —', '| 07 —'))).toBe('stage-06');
  });
});

describe('запуск процесса', () => {
  it('снимает будущую паузу при ручном перезапуске незавершённой задачи', () => {
    const state: Pick<LoopState, 'activeTask' | 'retryAfter'> = {
      activeTask: {
        task: '07/T17ceca',
        base: 'abc',
        workPrompt: '$task 07/T17ceca',
        phase: 'review',
        findings: [],
      },
      retryAfter: 2_000,
    };

    expect(clearInterruptedBackoff(state, 1_000)).toBe(true);
    expect(state.retryAfter).toBeUndefined();
  });

  it('не трогает истёкшую паузу: её завершит обычный шаг цикла', () => {
    const state: Pick<LoopState, 'activeTask' | 'retryAfter'> = {
      activeTask: {
        task: '07/T17ceca',
        base: 'abc',
        workPrompt: '$task 07/T17ceca',
        phase: 'review',
        findings: [],
      },
      retryAfter: 1_000,
    };

    expect(clearInterruptedBackoff(state, 1_000)).toBe(false);
    expect(state.retryAfter).toBe(1_000);
  });

  it('передаёт спецсимволы через stdin без изменений', async () => {
    const input = 'строка "кавычки" $next & | > <\nвторая строка';
    const result = await defaultRunCommand('node', ['-e', 'process.stdin.pipe(process.stdout)'], {
      input,
    });
    expect(result.stdout).toBe(input);
  });
});
