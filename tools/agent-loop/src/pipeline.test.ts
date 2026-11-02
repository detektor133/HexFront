import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Board, MAIN_AGENT } from './board.ts';
import { loadState } from './state.ts';
import { fixtureStage, runWorld, setMark, type Session } from './test-world.ts';

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

  it('зелёный gate текущего HEAD исключает старое замечание о красной проверке', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit(),
        review(
          '{"outcome":"ВОЗВРАТ","findings":[{"kind":"ТЕСТ","basis":"gate","text":"старый verify красный: Test timed out in 5000ms"}]}',
        ),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts).toHaveLength(2);
    expect(run.prompts[1]).toContain('Проверка текущего HEAD');
    expect(run.lines.join('\n')).toContain('устаревших пункт(ов) gate пропущено');
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

  it('нехватка памяти после коммита сохраняет HEAD для повторной проверки без кодера', async () => {
    const run = await runWorld({
      sessions: [codeCommit()],
      verify: ['verify: FAIL build\nmemory allocation of 312304 bytes failed'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual(['$task 06/T1j5-Б1']);
    expect(run.state?.activeTask?.phase).toBe('verify');
    expect(run.state?.activeTask?.findings).toEqual([]);
    expect(run.state?.retryAfter).toBeDefined();
    expect(run.lines.join('\n')).toContain('системе не хватило памяти');
  });

  it('после освобождения памяти повторяет проверку сохранённого HEAD', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'verify',
          findings: [],
        },
      },
      sessions: [review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[0]).toContain('$review 06/T1j5-Б1');
    expect(run.prompts.join('\n')).not.toContain('$task 06/T1j5-Б1');
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
        'pre-push: FAIL\nдочерний элемент группы 2 выходит за группу',
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
    expect(run.prePushCalls).toBe(3);
    expect(run.pushesAtPrePush).toEqual([0, 0, 0]);
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

  it('разовый сбой браузерного gate перепроверяет на том же HEAD без вызова кодера', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK')],
      prePush: ['pre-push: FAIL\ngetByRole banner not found', 'pre-push: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prePushCalls).toBe(2);
    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('нехватка памяти полного gate не создаёт пункт КОД и не зовёт исполнителя', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK')],
      prePush: ['pre-push: FAIL\nmemory allocation of 312304 bytes failed'],
    });

    expect(run.state?.activeTask?.phase).toBe('pre-push');
    expect(run.state?.activeTask?.findings).toEqual([]);
    expect(run.state?.retryAfter).toBeDefined();
    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
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

  it('после перезапуска снимает паузу активной задачи по лимиту Codex и продолжает её', async () => {
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

    expect(run.prompts[0]).toContain('$task 06/T1j5-Б1');
    expect(run.state?.retryAfter).toBeUndefined();
  });

  it('сохраняет исходный HEAD, если Codex создал коммит и затем сообщил сбой', async () => {
    const run = await runWorld({
      sessions: [{ answer: 'Ошибка после коммита.', code: 1, commit: true }],
    });
    expect(run.state?.activeTask?.workAttempt?.head).toBe('c0');
    expect(run.state?.activeTask?.phase).toBe('work');
    expect(run.state?.retryAfter).toBeDefined();
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
    expect(run.prompts[0]).toContain('координаты бери из данных объекта и преобразования карты');
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

  it('таймаут полного check повторяется на том же HEAD без возврата исполнителю', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK'), review('OK')],
      preReview: ['check: FAIL\nTest timed out in 5000ms', 'check: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.preReviewCalls).toBe(2);
    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain('полный check 06/T1j5-Б1: таймаут теста, повторяю на том же HEAD');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('красный полный check не ждёт владельца, когда reviewer вернул OK', async () => {
    const run = await runWorld({
      sessions: [
        codeCommit(),
        review('OK'),
        codeCommit('Исправил ошибку полного check.'),
        review('OK'),
        review('OK'),
      ],
      preReview: ['check: FAIL\nFAIL fixture.test.ts\nError: wrong setup', 'check: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[2]).toContain('полный check красный. Воспроизведи упавший тест');
    expect(run.prompts[2]).toContain('проверь его предпосылки');
    expect(run.prompts[2]).toContain('wrong setup');
    expect(run.lines).not.toContain(
      'жду: 06/T1j5-Б1: reviewer не классифицировал красный полный локальный контур',
    );
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('после обновления цикла продолжает задачу из старого ожидания check-review', async () => {
    const run = await runWorld({
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'review',
          findings: [],
        },
        parked: {
          key: 'check-review:06/T1j5-Б1',
          head: 'c0',
          reason: 'reviewer не классифицировал красный полный локальный контур',
        },
      },
      sessions: [review('OK')],
      preReview: ['check: OK'],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[0]).toContain('$review 06/T1j5-Б1');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('старый красный CI без лога перечитывает один раз и перезапускает таймаут без кодера', async () => {
    const run = await runWorld({
      sessions: [],
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'КОД', text: 'КОД: технический блокер после красного CI' }],
          ciRetries: 2,
          workAttempt: { head: 'c0', remote: 'c0', dirtyPaths: [] },
        },
      },
      ci: [
        'Test timed out in 5000ms.\nrun_attempt=1\nfailure job=check https://github.com/acme/game/actions/runs/123',
        'success https://github.com/acme/game/actions/runs/123',
        'success https://github.com/acme/game/actions/runs/124',
      ],
    });

    expect(run.reruns).toEqual([123]);
    expect(run.prompts).toEqual([]);
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

  it('новый конкретный пункт узкого review передаёт исполнителю без остановки plan', async () => {
    const oldFinding = 'ТЕСТ: рамка не проверяет движущуюся фишку';
    const newFinding = 'ТЕСТ: городское смещение не изолировано от смещения стопки';
    const run = await runWorld({
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'target-review',
          findings: [{ kind: 'ТЕСТ', text: oldFinding }],
          findingRetries: 1,
        },
      },
      sessions: [
        review(`ВОЗВРАТ\n- ${newFinding}`),
        {
          answer: 'Исправлена проверка сдвига города.',
          writes: { 'packages/sim/test/task.test.ts': "it('город', () => {});\n" },
          files: ['packages/sim/test/task.test.ts'],
          commit: true,
          push: false,
        },
        review('OK'),
      ],
      maxRounds: 1,
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[1]).toContain(newFinding);
    expect(run.prompts[1]).toContain('ПЕРЕДЕЛАТЬ:');
    expect(run.lines).toContain(
      'узкий review 06/T1j5-Б1: исправление не принято, меняю способ проверки',
    );
    expect(run.lines.join('\n')).not.toContain('plan не изменил повторно отклонённый пункт');
  });

  it('перефразирование того же дефекта не сбрасывает переделку тестового пути', async () => {
    const finding = 'ТЕСТ: тест вызывает callback вместо реального ввода';
    const reworded = 'ТЕСТ: реальный ввод карты обойдён вызовом callback';
    const run = await runWorld({
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
        {
          answer: 'Усилены утверждения старого теста.',
          writes: { 'packages/sim/test/task.test.ts': "it('callback', () => {});\n" },
          commit: true,
          push: false,
        },
        review(`ВОЗВРАТ\n- ${reworded}`),
        codeCommit('Заменена фикстура, проверяется реальный ввод.'),
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.slice(0, 4).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
    ]);
    expect(run.prompts[3]).toContain(reworded);
    expect(run.prompts[3]).toContain('Замени проблемный подход');
    expect(run.prompts.join('\n')).not.toContain('$plan 06/T1j5-Б1');
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

  it('после начала кода передаёт повторный дефект на переделку без позднего разбиения', async () => {
    const run = await runWorld({
      plan: true,
      state: {
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'base-before-work',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'review',
          findings: [],
          fullReviewRounds: 1,
        },
      },
      sessions: [
        review('ВОЗВРАТ\n- ТЕСТ: проверяемый путь подменён'),
        codeCommit('Исправлен тестовый стык.'),
        review('OK'),
      ],
      maxRounds: 1,
    });

    expect(run.prompts.slice(0, 2).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
    ]);
    expect(run.prompts[1]).toContain('ПЕРЕДЕЛАТЬ:');
    expect(run.prompts.join('\n')).not.toContain('$plan 06/T1j5-Б1');
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
    expect(run.prompts[0]).toContain('Сначала проверь фактическую предпосылку пункта');
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

  it('оспоренный исполнителем пункт проверяется независимо и снимается без фиктивного коммита', async () => {
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
        { answer: 'Измерение на реальном контейнере опровергает пункт.', push: false },
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
    expect(run.prompts[1]).toContain('Измерение на реальном контейнере опровергает пункт');
    expect(run.prompts[1]).toContain('воспроизводимым контрпримером');
    expect(run.lines).toContain(
      'узкий review 06/T1j5-Б1: пункт снят после независимой проверки, осталось 0 пунктов',
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

  it('после таймаута теста в CI один раз перезапускает job того же SHA без патча продукта', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK'), review('OK')],
      ci: [
        'Test timed out in 5000ms.\nrun_attempt=1\nfailure job=check https://github.com/acme/game/actions/runs/123',
        'success https://github.com/acme/game/actions/runs/123',
        'success https://github.com/acme/game/actions/runs/124',
      ],
    });

    expect(run.reruns).toEqual([123]);
    expect(run.ciArgs[1]).toContain('--after-attempt=1');
    expect(run.prompts.filter((prompt) => prompt.startsWith('$task'))).toHaveLength(1);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('таймаут Playwright в CI повторяет тот же SHA без возврата текущей задачи', async () => {
    const run = await runWorld({
      sessions: [codeCommit(), review('OK'), review('OK')],
      ci: [
        '1) [desktop] › tests/e2e/t17bmb-hex-card-layout.spec.ts:6:3\nTest timeout of 30000ms exceeded.\nrun_attempt=1\nfailure job=check https://github.com/acme/game/actions/runs/123',
        'success https://github.com/acme/game/actions/runs/123',
        'success https://github.com/acme/game/actions/runs/124',
      ],
    });
    expect(run.reruns).toEqual([123]);
    expect(run.prompts.filter((prompt) => prompt.startsWith('$task'))).toHaveLength(1);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('таймаут, повторившийся после перезапуска job, даёт кодеру замечание о лимите теста, а не ПЛАН', async () => {
    const timeout =
      '1) [desktop] › apps/client/tests/e2e/t17bq-popup-layout.spec.ts:11:3\nTest timeout of 30000ms exceeded.';
    const run = await runWorld({
      sessions: [
        codeCommit(),
        review('OK'),
        codeCommit('Увеличен лимит времени теста.'),
        review('OK'),
        review('OK'),
      ],
      ci: [
        `${timeout}\nrun_attempt=1\nfailure job=check https://github.com/acme/game/actions/runs/123`,
        `${timeout}\nrun_attempt=2\nfailure job=check https://github.com/acme/game/actions/runs/123`,
        'success https://github.com/acme/game/actions/runs/125',
        'success https://github.com/acme/game/actions/runs/126',
      ],
    });

    expect(run.reruns).toEqual([123]);
    const fix = run.prompts.find((prompt) => prompt.includes('лимита времени теста'));
    expect(fix).toContain('apps/client/tests/e2e/t17bq-popup-layout.spec.ts');
    expect(fix).not.toContain('ПЛАН:');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
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
