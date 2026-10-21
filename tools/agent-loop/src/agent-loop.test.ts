import { describe, expect, it } from 'vitest';

import { defaultRunCommand } from './agent-loop.ts';
import {
  closedStageBranch,
  commandTask,
  isOwnerTask,
  parseQueue,
  selectTask,
  taskMark,
} from './stage-file.ts';
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
  it('передаёт спецсимволы через stdin без изменений', async () => {
    const input = 'строка "кавычки" $next & | > <\nвторая строка';
    const result = await defaultRunCommand('node', ['-e', 'process.stdin.pipe(process.stdout)'], {
      input,
    });
    expect(result.stdout).toBe(input);
  });
});
