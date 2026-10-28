import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Board, MAIN_AGENT } from './board.ts';
import { loadState } from './state.ts';
import { fixtureStage, fixtureStatus, runWorld, setMark, type Session } from './test-world.ts';

const codeCommit = (answer = 'Код готов.'): Session => ({
  answer,
  writes: { 'packages/sim/src/task.ts': 'export const task = true;\n' },
  commit: true,
  push: false,
});
const review = (answer: string): Session => ({ answer, push: false });

describe('последовательный конвейер задачи', () => {
  it('исполнитель пишет код и тесты одним проходом, push идёт после review', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Код и тест готовы.',
          writes: {
            'packages/sim/src/task.ts': 'export const task = true;\n',
            'packages/sim/test/task.test.ts': "it('критерий', () => {});\n",
          },
          commit: true,
        },
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.roles).toEqual(['', 'reviewer']);
    expect(run.execs).toContain('vitest run packages/sim/test/task.test.ts');
    expect(run.verifyCalls).toBe(1);
    expect(run.pushes).toBe(2);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('разовый таймаут рабочего verify проверяет повторно без сессии исполнителя', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK')],
      verify: ['verify: FAIL tests\nTest timed out in 5000ms', 'verify: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.verifyCalls).toBe(2);
    expect(run.prompts).toHaveLength(2);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('повторный таймаут рабочего verify остаётся красным', async () => {
    const run = await runWorld({
      sessions: [codeCommit()],
      verify: [
        'verify: FAIL tests\nTest timed out in 5000ms',
        'verify: FAIL tests\nTest timed out in 5000ms',
      ],
      maxRounds: 1,
    });

    expect(run.verifyCalls).toBe(2);
    expect(run.pushes).toBe(0);
    expect(run.state?.activeTask?.findings[0]?.text).toContain('проверки задачи красные');
  });

  it('красный локальный gate возвращает дефект без push и повторяет gate после исправления', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit(),
        review('OK'),
        codeCommit('Исправлена ошибка локальной приёмки.'),
        review('OK'),
        review('OK'),
      ],
      prePush: [
        [
          'pre-push: FAIL',
          ...Array.from({ length: 14 }, (_, index) => `шум ${index}`),
          '+ "дочерний элемент группы 2 выходит за группу"',
          ...Array.from({ length: 8 }, (_, index) => `хвост ${index}`),
        ].join('\n'),
        'pre-push: OK',
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[2]).toContain('КОД: локальная приёмка перед push красная');
    expect(run.prompts[2]).toContain('дочерний элемент группы 2 выходит за группу');
    expect(run.prePushCalls).toBe(2);
    expect(run.pushesAtPrePush).toEqual([0, 0]);
    expect(run.pushes).toBe(2);
    expect(run.ciCalls).toBe(2);
  });

  it('разовый таймаут полного gate перепроверяет на том же HEAD без возврата исполнителю', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK')],
      prePush: ['pre-push: FAIL\nTest timed out in 5000ms', 'pre-push: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prePushCalls).toBe(2);
    expect(run.commitDepthsAtPrePush).toEqual([1, 1]);
    expect(run.prompts).toHaveLength(2);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('повторный таймаут полного gate остаётся красным и запрещает push', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK')],
      prePush: [
        'pre-push: FAIL\nTest timed out in 5000ms',
        'pre-push: FAIL\nTest timed out in 5000ms',
      ],
      maxRounds: 1,
    });

    expect(run.prePushCalls).toBe(2);
    expect(run.pushes).toBe(0);
    expect(run.lines).toContain('локальная приёмка 06/T1j5-Б1: FAIL, push запрещён');
  });

  it('после правки продукта повторяет все тесты задачи и возвращает красный результат тому же исполнителю', async () => {
    const run = await runWorld({
      sessions: [
        {
          answer: 'Первый срез.',
          writes: {
            'packages/sim/src/task.ts': 'export const task = true;\n',
            'packages/sim/test/first.test.ts': "it('первый', () => {});\n",
            'packages/sim/test/second.test.ts': "it('второй', () => {});\n",
          },
          commit: true,
        },
        {
          answer: 'Исправлена подготовка состояния.',
          writes: { 'packages/sim/src/task.ts': 'export const task = false;\n' },
          commit: true,
        },
        review('OK'),
        review('OK'),
      ],
      unit: ['FAIL подготовка состояния', 'unit: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[1]).toContain('pnpm exec vitest run packages/sim/test/first.test.ts');
    expect(run.prompts[1]).toContain('FAIL подготовка состояния');
    expect(run.prompts[1]).toContain('$task 06/T1j5-Б1');
    expect(run.execs.filter((line) => line.includes('vitest run'))).toEqual([
      'vitest run packages/sim/test/first.test.ts packages/sim/test/second.test.ts',
      'vitest run packages/sim/test/first.test.ts packages/sim/test/second.test.ts',
    ]);
    expect(run.lines.join('\n')).toContain('готово: 06/T1j5-Б1');
  });

  it('повтор той же ошибки после нового коммита требует сменить подход через plan', async () => {
    const run = await runWorld({
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
        },
      },
      sessions: [
        {
          answer: 'Первый срез.',
          writes: {
            'packages/sim/src/task.ts': 'export const task = true;\n',
            'packages/sim/test/task.test.ts': "it('критерий', () => {});\n",
          },
          commit: true,
        },
        {
          answer: 'Вторая попытка.',
          writes: { 'packages/sim/src/task.ts': 'export const task = false;\n' },
          commit: true,
        },
        { answer: 'PLAN: переделать — заменить неверную фикстуру', push: false },
      ],
      unit: [
        'unit: FAIL фикстура не открывает экран 100ms',
        'unit: FAIL фикстура не открывает экран 200ms',
      ],
      maxRounds: 2,
    });

    expect(run.prompts.slice(0, 3).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
    ]);
    expect(run.prompts[2]).toContain('повторилось то же падение проверки');
    expect(run.lines).toContain(
      '06/T1j5-Б1: plan решил переделать механизм целиком — заменить неверную фикстуру',
    );
  });

  it('замечания к продукту и тесту исправляет один исполнитель одним пакетом', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit(),
        review('ВОЗВРАТ\n- КОД: нет кнопки\n- ТЕСТ: неверная фикстура'),
        {
          answer: 'Исправлены кнопка и фикстура.',
          writes: {
            'packages/sim/src/task.ts': 'export const task = false;\n',
            'packages/sim/test/task.test.ts': "it('фикстура', () => {});\n",
          },
          commit: true,
        },
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[2]).toContain('КОД: нет кнопки');
    expect(run.prompts[2]).toContain('ТЕСТ: неверная фикстура');
    expect(run.prompts[3]).toContain('Узкая проверка');
    expect(run.execs).toContain('vitest run packages/sim/test/task.test.ts');
    expect(run.commitDepthsAtPrePush).toEqual([1]);
  });

  it('после перезапуска переводит старую очередь ТЕСТ и КОД на одного исполнителя', async () => {
    const run = await runWorld({
      spec: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [
            { kind: 'ТЕСТ', text: 'ТЕСТ: неверная фикстура' },
            { kind: 'КОД', text: 'КОД: отсутствует кнопка' },
          ],
        },
        spec: { '06/T1j5-Б1': { 'packages/sim/test/task.test.ts': 'старый тест' } },
      },
      sessions: [codeCommit(), review('OK'), review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[0]).toContain('$task 06/T1j5-Б1');
    expect(run.prompts[0]).toContain('ТЕСТ: неверная фикстура');
    expect(run.prompts[0]).toContain('КОД: отсутствует кнопка');
    expect(run.prompts.some((prompt) => prompt.startsWith('$spec'))).toBe(false);
    expect(run.locked.every((locked) => locked === '')).toBe(true);
  });

  it('продолжает свою незакоммиченную работу и диагностирует повторный красный тест без Issue владельца', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: 'КОД: добавить кнопку' }],
        },
      },
      sessions: [
        {
          answer: 'Тест Esc красный.',
          writes: {
            'packages/sim/src/task.ts': 'draft 1',
            'packages/sim/test/task.test.ts': 'draft test',
          },
          dirty: true,
        },
        {
          answer: 'Тест Esc всё ещё красный.',
          writes: { 'packages/sim/src/task.ts': 'draft 2' },
          dirty: true,
        },
        review('ВОЗВРАТ\n- ТЕСТ: фикстура не открывает карточку'),
        {
          answer: 'Та же предпосылка осталась красной.',
          writes: { 'packages/sim/test/task.test.ts': 'draft test 2' },
          dirty: true,
        },
        review('ВОЗВРАТ\n- ТЕСТ: фикстура по-прежнему выбирает армию вместо отряда'),
        {
          answer: 'Исправлены фикстура и продукт.',
          writes: {
            'packages/sim/src/task.ts': 'export const task = true;\n',
            'packages/sim/test/task.test.ts': "it('критерий', () => {});\n",
          },
          commit: true,
        },
        review('OK'),
        review('OK'),
      ],
      unit: [
        'FAIL подготовка состояния: карточка не открыта',
        'FAIL подготовка состояния: карточка не открыта',
        'FAIL подготовка состояния: карточка не открыта',
        'unit: OK',
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.lines.join('\n')).toContain('готово: 06/T1j5-Б1');
    expect(run.prompts.slice(0, 4).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
    ]);
    expect(run.prompts[1]).toContain('Предыдущая проверка: pnpm exec vitest run');
    expect(run.prompts[2]).toContain('pnpm exec vitest run packages/sim/test/task.test.ts');
    expect(run.prompts[2]).toContain('FAIL подготовка состояния: карточка не открыта');
    expect(run.prompts[2]).toContain('нарушенную предпосылку');
    expect(run.prompts[3]).toContain('ТЕСТ: фикстура не открывает карточку');
    expect(run.prompts[3]).toContain('Замечания reviewer — гипотезы');
    expect(run.prompts[3]).toContain('Действующий текст задачи — источник ожидаемого поведения:');
    expect(run.prompts[5]).toContain('ПЕРЕДЕЛАТЬ: повторная незакоммиченная попытка');
    expect(run.prompts[5]).toContain('выбирает армию вместо отряда');
    expect(run.lines.join('\n')).not.toContain('Ответ — Issue «$decide»');
  });

  it('после перезапуска снимает устаревший запрос владельцу для своей незакоммиченной работы', async () => {
    const run = await runWorld({
      dirty: 'packages/sim/src/task.ts',
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: 'КОД: красный тест Esc' }],
          workDirtyPaths: ['packages/sim/src/task.ts'],
        },
        resume: '06/T1j5-Б1',
        waitingAnswer: { task: '06/T1j5-Б1', reason: 'старый запрос владельцу' },
        parked: { key: 'resume:06/T1j5-Б1', head: 'c0', reason: 'старый запрос владельцу' },
      },
      sessions: [codeCommit(), review('OK'), review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[0]).toContain('Продолжи незакоммиченную работу этой задачи');
    expect(run.lines.join('\n')).not.toContain('старый запрос владельцу');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('при новой ошибке теста не требует переделывать уже изменённый подход', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: 'КОД: завершить задачу' }],
        },
      },
      sessions: [
        {
          answer: 'Карточка не открылась.',
          writes: { 'packages/sim/test/task.test.ts': 'draft 1' },
          dirty: true,
        },
        { answer: 'Фикстура изменена.', dirty: true },
        review('ВОЗВРАТ\n- ТЕСТ: не достигнуто состояние карточки'),
        { answer: 'Карточка открылась, но кнопка не нажимается.', dirty: true },
        review('ВОЗВРАТ\n- КОД: кнопка не отвечает на клик'),
        codeCommit(),
        review('OK'),
        review('OK'),
      ],
      unit: [
        'FAIL карточка не открыта',
        'FAIL карточка не открыта',
        'FAIL кнопка не нажимается',
        'unit: OK',
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[5]).not.toContain('ПЕРЕДЕЛАТЬ:');
    expect(run.prompts[5]).toContain('КОД: кнопка не отвечает на клик');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('передаёт красный verify без механического ремонта и при OK reviewer', async () => {
    const run = await runWorld({
      dirty: 'packages/sim/test/task.test.ts',
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'ТЕСТ', text: 'ТЕСТ: не открыта карточка' }],
          workDirtyPaths: ['packages/sim/test/task.test.ts'],
          workDirtyAttempts: 1,
        },
        resume: '06/T1j5-Б1',
      },
      sessions: [
        { answer: 'Тест красный.', dirty: ' M packages/sim/test/task.test.ts' },
        review('OK'),
        codeCommit(),
        review('OK'),
        review('OK'),
      ],
      unit: ['unit: OK', 'unit: OK'],
      verify: ['verify: FAIL lint\nerror apps/client/test/task.test.ts', 'verify: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[1]).toContain('pnpm verify --changed:\nverify: FAIL lint');
    expect(run.prompts[1]).toContain('error apps/client/test/task.test.ts');
    expect(run.prompts[2]).toContain('КОД: проверка красная');
    expect(run.prompts[2]).toContain('error apps/client/test/task.test.ts');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('сам исправляет форматирование только файлов активной задачи и повторяет verify', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: 'КОД: завершить задачу' }],
          workDirtyAttempts: 1,
        },
      },
      sessions: [
        {
          answer: 'Проверка форматирования красная.',
          writes: {
            'packages/sim/test/task.test.ts': 'draft',
            'apps/client/src/theme/tokens.ts': 'generated',
          },
          dirty: ' M packages/sim/test/task.test.ts\n M apps/client/src/theme/tokens.ts',
        },
        codeCommit(),
        review('OK'),
        review('OK'),
      ],
      verify: ['verify: FAIL prettier\n[warn] packages/sim/test/task.test.ts', 'verify: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.execs).toContain('prettier --write packages/sim/test/task.test.ts');
    expect(run.execs.join('\n')).not.toContain('prettier --write apps/client/src/theme/tokens.ts');
    expect(run.prompts[1]).toContain('Целевые тесты и verify зелёные; создай коммит');
    expect(run.prompts[1]).toContain('создай локальный коммит без дополнительных правок');
    expect(run.prompts.some((prompt) => prompt.startsWith('$review'))).toBe(true);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('после повторных зелёных проверок сам коммитит принадлежащую задаче работу', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
        },
      },
      sessions: [
        {
          answer: 'Исправлен продукт, коммит не создан.',
          writes: { 'packages/sim/src/task.ts': 'draft' },
          dirty: true,
        },
        { answer: 'Коммит всё ещё не создан.', dirty: true },
        { answer: 'Работа готова, коммит не создан.', dirty: true },
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.filter((prompt) => prompt.startsWith('$task'))).toHaveLength(3);
    expect(run.lines.join('\n')).toContain(
      'проверенная незакоммиченная работа сохранена оркестратором',
    );
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('передаёт исполнителю и reviewer причину отказа git commit', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
        },
      },
      sessions: [
        {
          answer: 'Код готов без коммита.',
          writes: { 'packages/sim/src/task.ts': 'draft' },
          dirty: true,
        },
        { answer: 'Код готов без коммита.', dirty: true },
        { answer: 'Код готов без коммита.', dirty: true },
        review('ВОЗВРАТ\n- КОД: исправить ошибку хука коммита'),
        codeCommit(),
        review('OK'),
        review('OK'),
      ],
      gitCommitFailures: ['pre-commit: проверка не прошла'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[3]).toContain('git commit: pre-commit: проверка не прошла');
    expect(run.prompts[4]).toContain('исправить ошибку хука коммита');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('не коммитит автоматически новый путь, появившийся после зелёного прогона', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
        },
      },
      sessions: [
        { answer: 'Черновик.', writes: { 'packages/sim/src/task.ts': 'draft' }, dirty: true },
        { answer: 'Готово.', dirty: true },
        {
          answer: 'Добавлен ещё один файл.',
          writes: { 'packages/sim/src/other.ts': 'new' },
          dirty: true,
        },
        codeCommit(),
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.lines.join('\n')).not.toContain('работа сохранена оркестратором');
    expect(run.prompts[3]).toContain('создай локальный коммит');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('не продолжает задачу, если к её грязному дереву добавлен чужой файл', async () => {
    const run = await runWorld({
      dirty: 'docs/STATUS.md',
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
          workDirtyPaths: ['packages/sim/src/task.ts'],
        },
        resume: '06/T1j5-Б1',
      },
      sessions: [],
    });

    expect(run.lines.join('\n')).toContain('рабочее дерево не чистое');
    expect(run.prompts).toEqual([]);
  });

  it('запоминает новый файл задачи даже при обрыве сессии по лимиту', async () => {
    const run = await runWorld({
      dirty: 'packages/sim/src/task.ts',
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: 'КОД: завершить задачу' }],
          workDirtyPaths: ['packages/sim/src/task.ts'],
        },
        resume: '06/T1j5-Б1',
      },
      sessions: [
        {
          answer: 'hit your usage limit',
          code: 1,
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          dirty: ' M packages/sim/src/task.ts',
        },
      ],
    });

    expect(run.state?.activeTask?.workDirtyPaths).toContain('packages/sim/test/task.test.ts');
    expect(run.state?.resume).toBe('06/T1j5-Б1');
    expect(run.lines.join('\n')).not.toContain('добавлены чужие файлы');
  });

  it('после перезапуска сохраняет паузу активной задачи по лимиту Codex', async () => {
    const run = await runWorld({
      dirty: 'packages/sim/src/task.ts',
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
          workDirtyPaths: ['packages/sim/src/task.ts'],
        },
        resume: '06/T1j5-Б1',
        retryAfter: 100_000,
      },
      sessions: [codeCommit()],
    });

    expect(run.prompts).toEqual([]);
    expect(run.state?.retryAfter).toBe(100_000);
    expect(run.state?.activeTask?.workDirtyPaths).toEqual(['packages/sim/src/task.ts']);
  });

  it('после обрыва процесса восстанавливает файлы начатой рабочей сессии', async () => {
    const run = await runWorld({
      dirty: 'packages/sim/src/task.ts\n?? packages/sim/test/task.test.ts',
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: 'КОД: завершить задачу' }],
          workDirtyPaths: ['packages/sim/src/task.ts'],
          workAttempt: { head: 'c0', remote: 'c0', dirtyPaths: ['packages/sim/src/task.ts'] },
        },
      },
      sessions: [{ answer: 'hit your usage limit', code: 1 }],
    });

    expect(run.prompts[0]).toContain('Продолжи незакоммиченную работу этой задачи');
    expect(run.state?.activeTask?.workDirtyPaths).toContain('packages/sim/test/task.test.ts');
    expect(run.lines.join('\n')).not.toContain('добавлены чужие файлы');
  });

  it('не приписывает задаче код цикла при восстановлении оборванной сессии', async () => {
    const run = await runWorld({
      dirty: 'packages/sim/src/task.ts\n?? tools/agent-loop/src/foreign.ts',
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
          workDirtyPaths: ['packages/sim/src/task.ts'],
          workAttempt: { head: 'c0', remote: 'c0', dirtyPaths: ['packages/sim/src/task.ts'] },
        },
      },
      sessions: [],
    });

    expect(run.prompts).toEqual([]);
    expect(run.lines.join('\n')).toContain('изменила код цикла');
  });

  it('каждой роли даёт действующий текст задачи без второй копии критериев', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[0]).toContain('Перед первым review сверь каждый критерий');
    expect(run.prompts[0]).toContain('найди все импорты, вызовы и старые тесты');
    expect(run.prompts[0]).toContain('Действующий текст задачи — источник ожидаемого поведения:');
    expect(run.prompts[0]).toContain('*Приёмка:* тесты.');
    expect(run.prompts[0]).not.toContain('1. *приёмка:* тесты');
    expect(run.prompts[1]).toContain('Проверь каждый пункт действующего блока задачи');
    expect(run.prompts[1]).toContain('проверь через rg все импорты, вызовы и старые тесты');
    expect(run.prompts[1]).toContain('Действующий текст задачи — источник ожидаемого поведения:');
    expect(run.prompts[1]).not.toContain('1. *приёмка:* тесты');
  });

  it('красный полный контур сначала разделяет дефекты кода и тестов через review', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit(),
        review('ВОЗВРАТ\n- КОД: удалённый экспорт всё ещё используется продуктом — src/task.ts:1'),
        codeCommit('Исправлен весь пакет ошибок полного контура.'),
        review('OK'),
        review('OK'),
      ],
      preReview: [
        'check: FAIL\nFAIL old.test.ts\nerror удалённый экспорт всё ещё импортируется',
        'check: OK',
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.preReviewCalls).toBe(2);
    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[1]).toContain('Классифицируй все ошибки по матрице задачи');
    expect(run.prompts[1]).toContain('устаревшее или противоречащее задаче ожидание — ТЕСТ');
    expect(run.prompts[1]).toContain('удалённый экспорт всё ещё импортируется');
    expect(run.prompts[2]).toContain('удалённый экспорт всё ещё используется продуктом');
    expect(run.lines).toContain('полный локальный контур перед review 06/T1j5-Б1: FAIL');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('после узкого review RED-тесты активной задачи не блокируют следующий тик', async () => {
    const acceptance = 'packages/sim/test/acceptance.test.ts';
    const run = await runWorld({
      spec: true,
      dirty: acceptance,
      state: {
        spec: { '06/T1j5-Б1': { [acceptance]: "it('приёмка', () => {});\n" } },
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'review',
          findings: [],
        },
      },
      sessions: [review('OK')],
      maxRounds: 1,
    });

    expect(run.prompts[0]?.split('\n')[0]).toBe('$review 06/T1j5-Б1');
    expect(run.lines.join('\n')).not.toContain('рабочее дерево не чистое');
  });

  it('осиротевшая запись state.spec (ни в HEAD, ни на диске) не паркует вечно — тихо убирается', async () => {
    const run = await runWorld({
      spec: true,
      state: {
        spec: {
          '06/T1j5-Б1': {
            // Путь, который $spec в более раннем раунде переименовал без удаления старого
            // ключа: его никогда не было в HEAD и сейчас нет на диске — терять нечего.
            'apps/client/test/ghost.test.ts': "it('устаревший', () => {});\n",
          },
        },
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
        },
      },
      sessions: [codeCommit(), review('OK')],
    });

    expect(run.lines.join('\n')).not.toContain('не закоммичен');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('узкий пункт review, назвавший файл цикла по имени, не паркуется как самовольная правка', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit(),
        review(
          'ВОЗВРАТ\n- КОД: tools/agent-loop/src/test-world.ts:309 — молчаливый catch {} запрещён',
        ),
        {
          answer: 'Исправлен ровно один пункт reviewer: убран молчаливый catch.',
          writes: { 'tools/agent-loop/src/test-world.ts': 'export const fixed = true;\n' },
          files: ['tools/agent-loop/src/test-world.ts'],
          commit: true,
          push: false,
        },
        review('OK'),
      ],
    });

    // 07/T22 ловил самовольную правку цикла, не исполнение дефекта, который независимый review
    // сам нашёл и назвал по имени файла в своём пункте.
    expect(run.lines.join('\n')).not.toContain('изменила код цикла');
    expect(run.lines).toContain('узкий review 06/T1j5-Б1: OK, осталось 0 пунктов');
  });

  it('правка файла цикла, которую не называл пункт review, всё равно паркуется', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit(),
        review('ВОЗВРАТ\n- КОД: packages/sim/src/task.ts:1 — неверная проверка'),
        {
          answer: 'Заодно поправил цикл.',
          writes: { 'tools/agent-loop/src/other.ts': 'export const x = 1;\n' },
          files: ['packages/sim/src/task.ts', 'tools/agent-loop/src/other.ts'],
          commit: true,
          push: false,
        },
      ],
    });

    expect(run.lines.join('\n')).toContain(
      'изменила код цикла (tools/agent-loop/src/other.ts) без поручения владельца',
    );
  });

  it('после первого повторного возврата зовёт plan, после второго — тоже plan, и только затем останавливается', async () => {
    const finding = 'ТЕСТ: тест не проверяет границы';
    const run = await runWorld({
      spec: true,
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'target-review',
          findings: [{ kind: 'ТЕСТ', text: finding }],
        },
      },
      sessions: [
        review(`ВОЗВРАТ\n- ${finding}`),
        { answer: 'PLAN: не трогал', push: false },
        {
          answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
          writes: { 'packages/sim/test/task.test.ts': "it('границы', () => {});\n" },
          commit: true,
          push: false,
        },
        review(`ВОЗВРАТ\n- ${finding}`),
        { answer: 'PLAN: не трогал', push: false },
      ],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
    ]);
    expect(run.prompts[4]).toContain('узкий review дважды не принял один и тот же пункт');
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1: plan не изменил повторно отклонённый пункт; автоматический повтор той же роли запрещён',
    );
  });

  it('второй подряд отказ узкого review может закончиться не остановкой, а разбиением задачи', async () => {
    const finding = 'КОД: неверный путь';
    const split = fixtureStage.replace(
      '- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).\n  *Приёмка:* тесты.',
      '- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).\n  *Приёмка:* тесты.\n' +
        '- [ ] **T1j5-Б1a. Часть первая** (tools/evolve).\n  *Приёмка:* тесты.\n' +
        '- [ ] **T1j5-Б1b. Часть вторая** (tools/evolve).\n  *Проверка:* интеграция.',
    );
    const splitStatus = fixtureStatus.replace(
      'Очередь: 06/T1j5-Б1 → 06/T1i → 06/T1e',
      'Очередь: 06/T1j5-Б1a → 06/T1j5-Б1b → 06/T1i → 06/T1e',
    );
    const run = await runWorld({
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'target-review',
          findings: [{ kind: 'КОД', text: finding }],
          findingRetries: 1,
          fixStreak: { file: 'apps/client/src/dev/Hud.module.css', count: 3 },
        },
      },
      sessions: [
        review(`ВОЗВРАТ\n- ${finding}`),
        {
          answer: 'Объём на деле больше одной подсистемы — разбита на 2 подзадачи.\nPLAN: разбито',
          stage: split,
          status: splitStatus,
          commit: true,
          files: ['docs/stages/stage-06-bots-balance.md', 'docs/STATUS.md', 'docs/DECISIONS.md'],
        },
        review('OK'),
        { answer: 'Текст первой подзадачи достаточен.\nPLAN: не трогал' },
      ],
      maxRounds: 1,
    });

    // Разбиение не отменяет уже закоммиченную работу исходной задачи: её review проходит
    // дальше обычным порядком (pre-push → CI → docs-коммит), а очередь уже ведёт на первую
    // подзадачу — цикл успевает начать и её проверку текста роль plan в рамках того же прогона.
    expect(run.prompts.slice(0, 3).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[1]).toContain('узкий review дважды не принял один и тот же пункт');
    expect(run.prompts[1]).toContain('Hud.module.css патчится 3 раз(а) подряд');
    expect(run.lines).toContain('$plan 06/T1j5-Б1: разбито');
    expect(run.lines).not.toContain(
      expect.stringContaining('автоматический повтор той же роли запрещён'),
    );
  });

  it('финальный review второй круг подряд находит новые пункты — зовёт plan, а не очередной патч', async () => {
    const finding = 'КОД: другой дефект, не связанный с предыдущими пунктами';
    const run = await runWorld({
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'review',
          findings: [],
          fullReviewRounds: 1,
        },
      },
      sessions: [
        review(`ВОЗВРАТ\n- ${finding}`),
        { answer: 'Текст задачи ясен, review предъявляет избыточные требования.\nPLAN: не трогал' },
        codeCommit('Исправлен дефект.'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    // Это первая попытка на свежем пункте, не повторный отказ: «не трогал» от plan означает «текст
    // в порядке, пункт реальный» — исполнитель получает обычную попытку, а не паркуется мимо неё.
    expect(run.prompts.slice(0, 3).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
    ]);
    expect(run.prompts[1]).toContain('2 раз(а) подряд возвращает новые пункты');
    expect(run.prompts[1]).toContain('вместо схождения к нулю');
    expect(run.lines).toContain(
      '06/T1j5-Б1: plan не нашёл конфликт требований, даю исправляющей роли последнюю попытку',
    );
  });

  it('не паркует пакет замечаний, если plan не дописал служебный PLAN-маркер', async () => {
    const finding = 'КОД: дефект требует обычного исправления';
    const run = await runWorld({
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'review',
          findings: [],
          fullReviewRounds: 1,
        },
      },
      sessions: [
        review(`ВОЗВРАТ\n- ${finding}`),
        { answer: 'Текст задачи ясен, замечание относится к реализации.' },
        codeCommit('Исправлен дефект.'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.slice(0, 3).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain(
      '$plan 06/T1j5-Б1: нет PLAN-маркера, документы не менялись — продолжаю пакет замечаний',
    );
  });

  it('после продуктового коммита через цепочку точек идёт на финальный review, не на голый workPrompt', async () => {
    // 07/T17ar, 2026-10-22: resumeWorkAfterFindings был выставлен на самом первом СПЕК, затем
    // reroute на КОД и настоящий продуктовый коммит закрыли задачу целиком через цепочку точек —
    // но когда findings опустели, флаг всё равно звал голый workPrompt; исполнитель отвечал
    // «уже реализована», коммита не было, и цикл парковался на «не создала локальный коммит»,
    // хотя задача была полностью готова и прошла review.
    // resumeWorkAfterFindings выставляется первым возвратом «СПЕК:» (finding-repair.ts) и
    // переживает весь остаток цепочки точек; здесь он уже стоит, а единственная оставшаяся точка —
    // обычный КОД-пункт из прежнего reroute, чтобы не завязываться на точный путь $spec/reroute.
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: 'КОД: лес не рисует ожидаемые круги' }],
          resumeWorkAfterFindings: true,
        },
      },
      sessions: [codeCommit('Продуктовый фикс готов.'), review('OK'), review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain('узкий review 06/T1j5-Б1: OK, осталось 0 пунктов');
    expect(run.lines).not.toContain(expect.stringContaining('не создала локальный коммит'));
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('не запускает роль повторно для припаркованной активной задачи', async () => {
    const reason = '06/T1j5-Б1: критерий требует решения владельца после диагностики plan';
    const board = new Board(() => 0);
    const run = await runWorld({
      board,
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'ПЛАН', text: 'ПЛАН: jsdom не вычисляет геометрию CSS' }],
        },
        parked: { key: 'plan:06/T1j5-Б1', head: 'c0', reason },
      },
      sessions: [],
    });

    expect(run.prompts).toEqual([]);
    expect(run.lines).not.toContain(`жду: ${reason}`);
    expect(board.agents().find((agent) => agent.name === MAIN_AGENT)).toMatchObject({
      phase: 'wait',
      task: '06/T1j5-Б1',
      text: reason,
    });
  });

  it('диагностика plan передаёт технический блокер кодеру без владельца', async () => {
    const run = await runWorld({
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'ПЛАН', text: 'ПЛАН: jsdom не вычисляет геометрию CSS' }],
        },
      },
      sessions: [
        { answer: 'PLAN: инфраструктура — геометрию проверить через Playwright' },
        codeCommit('Добавлен браузерный тест геометрии.'),
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$plan 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[0]).toContain(
      'Технический конфликт тестового слоя не требует решения владельца',
    );
    expect(run.prompts[1]).toContain('КОД: устранить технический блокер без участия владельца');
    expect(run.lines).toContain(
      '06/T1j5-Б1: технический блокер передан исполнителю, владелец не требуется',
    );
  });

  it('исполнитель без коммита и без машинного маркера — зовёт plan, а не паркует сразу владельцу', async () => {
    const finding = 'КОД: меню не открывается после удержания фишки на canvas';
    const run = await runWorld({
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: finding }],
        },
      },
      sessions: [
        {
          answer:
            'Не коммитил: исправление ломает другой уже принятый тест t17an-radial-menu.test.ts.',
          push: false,
        },
        review(`ВОЗВРАТ\n- ${finding}`),
        {
          answer:
            'Другой подход: обрабатывать pointerdown раньше, не после release.\n' +
            'PLAN: переделать — обрабатывать pointerdown раньше, не после release',
        },
      ],
      maxRounds: 1,
    });

    // Без диагностики plan это сразу встало бы на «нужен ответ владельца через $decide/$done»,
    // хотя у исполнителя уже есть внятный диагноз провала (сломанный чужой тест) и есть кому
    // предложить другой подход.
    expect(run.prompts.slice(0, 3).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
    ]);
    expect(run.prompts[2]).toContain('не дал машинный маркер');
    expect(run.prompts[2]).toContain('ломает другой уже принятый тест');
    expect(run.lines).toContain(
      '06/T1j5-Б1: plan решил переделать механизм целиком — обрабатывать pointerdown раньше, не после release',
    );
  });

  it('исполнитель без нового коммита снимает уже исправленный предыдущим патчем пункт через review', async () => {
    const finding = 'КОД: раскладка ограничивает ленту тремя строками';
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [
            { kind: 'КОД', text: finding },
            { kind: 'ТЕСТ', text: 'ТЕСТ: добавить сценарий четвёртой строки' },
          ],
        },
      },
      sessions: [
        { answer: 'Пункт уже исправлен предыдущим коммитом.', push: false },
        review('OK'),
        review('OK'),
      ],
      maxRounds: 1,
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain(
      'узкий review 06/T1j5-Б1: пункт уже исправлен предыдущим патчем, осталось 0 пунктов',
    );
    expect(run.lines).not.toContain(expect.stringContaining('жду:'));
  });

  it('после красного CI повторно публикует исправленный HEAD без ложного конфликта origin', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        codeCommit(),
        review('OK'),
        codeCommit('Исправлен красный CI.'),
        review('OK'),
        review('OK'),
      ],
      ci: [
        'failure job=check https://ci/failed',
        'success https://ci/fixed',
        'success https://ci/docs',
      ],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[2]).toContain('КОД: CI точного SHA красный');
    expect(run.pushes).toBe(3);
    expect(run.ciCalls).toBe(3);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
    expect(run.lines).not.toContain(expect.stringContaining('автоматический rebase запрещён'));
  });

  it('останавливает задачу, если исполнитель push-нул до review', async () => {
    const run = await runWorld({ sessions: [{ ...codeCommit(), push: true }] });

    expect(run.prompts).toHaveLength(1);
    expect(run.lines).toContain('жду: 06/T1j5-Б1: рабочая сессия изменила origin до review');
    expect(run.ciCalls).toBe(0);
  });

  it('после перезапуска на docs-ci не создаёт служебный коммит повторно', async () => {
    const run = await runWorld({
      stage: setMark(fixtureStage, 'T1j5-Б1', 'x'),
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'docs-ci',
          findings: [],
        },
      },
      sessions: [],
      ci: ['success https://ci/docs'],
    });

    expect(run.prompts).toEqual([]);
    expect(run.pushes).toBe(0);
    expect(run.ciCalls).toBe(1);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('снимает устаревшую активную задачу, уже закрытую и опубликованную ведущей сессией', async () => {
    const run = await runWorld({
      stage: setMark(fixtureStage, 'T1j5-Б1', 'x'),
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'старый-origin',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [],
        },
        parked: {
          key: 'push:06/T1j5-Б1',
          head: 'c0',
          reason: '06/T1j5-Б1: origin изменился во время оборванной сессии',
        },
      },
      sessions: [],
    });

    expect(run.lines).toContain(
      '06/T1j5-Б1: закрытая и опубликованная задача удалена из памяти цикла',
    );
    expect(run.lines).toContain(
      'жду: очередь дошла до 06/T1i — это задача владельца. Когда сделаешь — Issue «$done 06/T1i» с текстом, что сделано',
    );
    expect(run.lines).not.toContain('жду: 06/T1j5-Б1: origin изменился во время оборванной сессии');
  });

  it('после перезапуска завершает оборванную финализацию', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'finalize',
          findings: [],
        },
      },
      sessions: [],
      ci: ['success https://ci/docs'],
    });

    expect(run.prompts).toEqual([]);
    expect(run.pushes).toBe(1);
    expect(run.ciCalls).toBe(1);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('загружает старые поля state без влияния на новый автомат', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hexfront-state-'));
    try {
      const path = join(root, '.ai-logs', 'agent-loop', 'state.json');
      await mkdir(join(root, '.ai-logs', 'agent-loop'), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({ testPhase: { '07/T1': 'write' }, reviewFeedback: { '07/T1': 'старое' } }),
        'utf8',
      );
      const state = await loadState(root);

      expect(state.activeTask).toBeUndefined();
      expect('testPhase' in state).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
