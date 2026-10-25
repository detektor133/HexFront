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
  it('пишет тест до кода, push делает после review и отдельно фиксирует статус', async () => {
    const spec: Session = {
      answer: 'Приёмочный тест записан.',
      writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
      push: false,
    };
    const run = await runWorld({
      spec: true,
      sessions: [spec, codeCommit(), review('OK')],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.roles).toEqual(['spec', '', 'reviewer']);
    expect(run.pushes).toBe(2);
    expect(run.prePushCalls).toBe(1);
    expect(run.ciCalls).toBe(2);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
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

  it('выдаёт дефекты пакетами по ролям и после каждого пакета запускает узкий review', async () => {
    const returned = review(
      'ВОЗВРАТ\n- КОД: критерий 1 — неверный путь, packages/sim/src/task.ts:1\n- ТЕСТ: критерий 2 — нет края, packages/sim/test/task.test.ts:1\n- КОД: критерий 3 — неверный результат, packages/sim/src/task.ts:2',
    );
    const codeFix: Session = {
      answer: 'Исправлен первый пункт.',
      writes: { 'packages/sim/src/task.ts': 'export const task = false;\n' },
      commit: true,
      push: false,
    };
    const testFix: Session = {
      answer: 'Исправлен второй пункт.\nРЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
      writes: { 'packages/sim/test/task.test.ts': "it('край', () => {});\n" },
      commit: true,
      push: false,
    };
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        returned,
        codeFix,
        review('OK'),
        testFix,
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$spec 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[3]).toContain('Исправь весь переданный пакет замечаний');
    expect(run.prompts[3]).toContain('КОД: критерий 1');
    expect(run.prompts[3]).toContain('КОД: критерий 3');
    expect(run.prompts[3]).not.toContain('ТЕСТ: критерий 2');
    expect(run.prompts[5]).toContain('ТЕСТ: критерий 2');
    expect(run.prompts[4]).toContain('Узкая проверка');
    expect(run.prompts[7]).toContain('Финальный полный review');
    expect(run.lines).toContain('06/T1j5-Б1: 3 локальных коммитов сведены в один перед push');
    expect(run.verifyCalls).toBe(1);
  });

  it('даёт repair-spec вторую попытку после своего красного verify, затем не повторяет и не шлёт на review', async () => {
    const specFix: Session = {
      answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
      writes: { 'packages/sim/test/task.test.ts': "it('ноль запрещён', () => {});\n" },
      commit: true,
      push: false,
    };
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест пропускает нулевой размер'),
        specFix,
        specFix,
      ],
      verify: ['verify: FAIL', 'verify: FAIL'],
    });

    expect(run.prompts.filter((prompt) => prompt.startsWith('$review'))).toHaveLength(1);
    expect(run.prompts.filter((prompt) => prompt.startsWith('$spec'))).toHaveLength(3);
    expect(run.verifyCalls).toBe(2);
    expect(run.lines).toContain(
      'repair-$spec 06/T1j5-Б1: заявил ИСПРАВЛЕНО, но verify --changed красный — даю вторую попытку',
    );
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1: repair-$spec второй раз подряд оставил красный verify --changed; повтор и review запрещены',
    );
  });

  it('если вторая попытка repair-spec зелёная, уходит на узкий review как обычно', async () => {
    const specFix: Session = {
      answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
      writes: { 'packages/sim/test/task.test.ts': "it('ноль запрещён', () => {});\n" },
      commit: true,
      push: false,
    };
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест пропускает нулевой размер'),
        specFix,
        specFix,
        review('OK'),
      ],
      verify: ['verify: FAIL', 'verify: OK'],
    });

    expect(run.prompts.filter((prompt) => prompt.startsWith('$spec'))).toHaveLength(3);
    expect(run.verifyCalls).toBe(2);
    expect(run.lines).toContain(
      'repair-$spec 06/T1j5-Б1: заявил ИСПРАВЛЕНО, но verify --changed красный — даю вторую попытку',
    );
    expect(run.lines).not.toContain(
      expect.stringContaining('repair-$spec второй раз подряд оставил красный'),
    );
    expect(run.lines).toContain('узкий review 06/T1j5-Б1: OK, осталось 0 пунктов');
  });

  it('repair-spec, оставивший правку без коммита, получает немедленный повтор, а не backoff', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест пропускает нулевой размер'),
        {
          // commit не указан: правка написана на диск, но дерево остаётся грязным.
          answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
          writes: { 'packages/sim/test/task.test.ts': "it('ноль запрещён', () => {});\n" },
        },
        {
          answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
          writes: { 'packages/sim/test/task.test.ts': "it('ноль запрещён', () => {});\n" },
          commit: true,
          push: false,
        },
        review('OK'),
      ],
    });

    // Содержимое уже верифицировано хуком конца хода — 30-минутный backoff бессмысленен для
    // забытого git commit, повтор идёт сразу же со своим прежним prompt'ом.
    expect(run.prompts.filter((prompt) => prompt.startsWith('$spec'))).toHaveLength(3);
    expect(run.prompts[4]).toContain('не создала git commit');
    expect(run.lines.join('\n')).not.toContain('следующая попытка через');
    expect(run.lines).toContain('узкий review 06/T1j5-Б1: OK, осталось 0 пунктов');
  });

  it('repair-spec с коммитом не принимает исходные красные тесты за свою незакоммиченную правку', async () => {
    const acceptance = 'packages/sim/test/acceptance.test.ts';
    const oldTest = 'packages/sim/test/old.test.ts';
    const run = await runWorld({
      spec: true,
      state: {
        spec: { '06/T1j5-Б1': { [acceptance]: "it('приёмка', () => {});\n" } },
        activeTask: {
          task: '06/T1j5-Б1',
          base: 'c0',
          remoteBase: 'c0',
          workPrompt: '$task 06/T1j5-Б1',
          phase: 'work',
          findings: [{ kind: 'ТЕСТ', text: `ТЕСТ: ${oldTest} содержит старое требование` }],
        },
      },
      dirty: acceptance,
      sessions: [
        {
          answer: `РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: ${oldTest}`,
          writes: {
            [oldTest]: "it('исправлено', () => {});\n",
            [acceptance]: "it('приёмка', () => {});\n",
          },
          files: [oldTest],
          commit: true,
          dirty: `?? ${acceptance}`,
        },
        review('OK'),
      ],
      maxRounds: 1,
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$spec 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.execs).toContain(`vitest run ${oldTest}`);
    expect(run.lines.join('\n')).not.toContain('не коммитит свою правку');
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

  it('НЕПРОВЕРЯЕМО на красный e2e не верится на слово — реальный прогон даёт вторую попытку', async () => {
    const specPath = 'apps/client/tests/e2e/task.spec.ts';
    const untestable = (): Session => ({
      answer: `РЕМОНТ: НЕПРОВЕРЯЕМО — запуск Playwright запрещён правилами проекта\nСПЕК: ${specPath}`,
      writes: { [specPath]: "test('@layout x', async () => {});\n" },
      commit: true,
      push: false,
    });
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест пропускает нулевой размер'),
        untestable(),
        untestable(),
        review('OK'),
      ],
      layout: ['layout: FAIL', 'layout: OK'],
    });

    // 2026-10-23, 07/T17as: $spec заявил «Playwright запрещён» (неверно — п.10 его же скилла это
    // прямо разрешает), а реальный прогон изменённого e2e был красным по существу. Цикл теперь не
    // верит вердикту на слово, а реально его перепроверяет.
    expect(run.layoutCalls).toBe(2);
    expect(run.prompts.filter((prompt) => prompt.startsWith('$spec'))).toHaveLength(3);
    expect(run.prompts[4]).toContain('реальный прогон изменённых тестов красный');
    expect(run.lines).toContain(
      'repair-$spec 06/T1j5-Б1: заявил НЕПРОВЕРЯЕМО, но изменённый тест красный — даю вторую попытку',
    );
    expect(run.lines).toContain('узкий review 06/T1j5-Б1: OK, осталось 0 пунктов');
  });

  it('НЕПРОВЕРЯЕМО второй раз подряд при красном тесте — паркует с реальной ошибкой', async () => {
    const specPath = 'apps/client/tests/e2e/task.spec.ts';
    const untestable = (): Session => ({
      answer: `РЕМОНТ: НЕПРОВЕРЯЕМО — запуск Playwright запрещён правилами проекта\nСПЕК: ${specPath}`,
      writes: { [specPath]: "test('@layout x', async () => {});\n" },
      commit: true,
      push: false,
    });
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест пропускает нулевой размер'),
        untestable(),
        untestable(),
      ],
      layout: ['layout: FAIL', 'layout: FAIL'],
    });

    expect(run.layoutCalls).toBe(2);
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1: repair-$spec второй раз подряд заявил НЕПРОВЕРЯЕМО при красном изменённом тесте',
    );
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

  it('repair-spec удаляет чужой приёмочный тест — паркует, а не падает с ENOENT', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест пропускает нулевой размер'),
        {
          answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/other.test.ts',
          writes: { 'packages/sim/test/other.test.ts': "it('другое', () => {});\n" },
          removes: ['packages/sim/test/task.test.ts'],
          files: ['packages/sim/test/task.test.ts', 'packages/sim/test/other.test.ts'],
          commit: true,
          push: false,
        },
      ],
    });

    // Автор тестов не имеет права удалять чужую проверку (AGENTS.md §4.5): цикл паркует с
    // понятной причиной, а не падает необработанным ENOENT при попытке прочитать удалённый файл.
    expect(run.lines).toContain(
      'жду: $spec 06/T1j5-Б1 удалил packages/sim/test/task.test.ts — проверь',
    );
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

  it('передаёт красный усиленный тест кодеру без лишнего review', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        codeCommit(),
        review('ВОЗВРАТ\n- ТЕСТ: тест не ловит переполнение'),
        {
          answer:
            'РЕМОНТ: КОД — усиленный тест выявил переполнение\nСПЕК: packages/sim/test/task.test.ts',
          writes: { 'packages/sim/test/task.test.ts': "it('переполнение', () => {});\n" },
          commit: true,
          push: false,
        },
        codeCommit('Исправлено переполнение.'),
        review('OK'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[4]).toContain('КОД: усиленный тест выявил переполнение');
    expect(run.verifyCalls).toBe(0);
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
      '$spec 06/T1j5-Б1',
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

  it('второй круг подряд на ТЕСТ-пункте, который plan решил переделать, уходит автору тестов, не кодеру', async () => {
    const finding =
      'ТЕСТ: apps/client/test/t17ar-terrain-layer.test.ts:120 — не проверяет равный объём вызовов';
    const run = await runWorld({
      spec: true,
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
        {
          answer:
            'Подход теста пора переписать целиком.\nPLAN: переделать — сверять снимки координат, а не отдельные вызовы',
        },
        {
          answer: 'РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: apps/client/test/t17ar-terrain-layer.test.ts',
          writes: {
            'apps/client/test/t17ar-terrain-layer.test.ts': "it('снимок координат', () => {});\n",
          },
          commit: true,
          push: false,
        },
      ],
      maxRounds: 1,
    });

    // Пункт был ТЕСТ — редизайн должен уйти $spec, а не $task, иначе роль без прав на правку
    // тестов получит задачу переписать тестовый подход.
    expect(run.prompts.slice(0, 3).map((prompt) => prompt.split('\n')[0])).toEqual([
      '$review 06/T1j5-Б1',
      '$plan 06/T1j5-Б1',
      '$spec 06/T1j5-Б1',
    ]);
    expect(run.prompts[2]).toContain('переписать целиком');
    expect(run.prompts[2]).toContain('РЕМОНТ: ИСПРАВЛЕНО');
  });

  it('СПЕК без коммита откатывает чужую правку продукта — следующий тик не паркует «дерево не чистое»', async () => {
    const specPath = 'apps/client/test/t17ar-terrain-layer.test.ts';
    const strayPath = 'apps/client/src/render/terrain-layer.ts';
    const run = await runWorld({
      spec: true,
      state: {
        spec: { '06/T1j5-Б1': { [specPath]: "it('критерий', () => {});\n" } },
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
          answer: `СПЕК: ${specPath}:10 — строгая типизация падает на неявных \`any\` в callback-параметрах.`,
          writes: { [strayPath]: 'export const broken = true;\n' },
          push: false,
        },
        {
          answer: `РЕМОНТ: ИСПРАВЛЕНО\nСПЕК: ${specPath}`,
          writes: { [specPath]: "it('критерий', (value: number) => {});\n" },
          commit: true,
          push: false,
        },
        review('OK'),
        codeCommit('Код готов после фикса теста.'),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$spec 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).not.toContain(expect.stringContaining('дерево не чистое'));
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
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
      sessions: [{ answer: 'Пункт уже исправлен предыдущим коммитом.', push: false }, review('OK')],
      maxRounds: 1,
    });

    expect(run.prompts.map((prompt) => prompt.split('\n')[0])).toEqual([
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain(
      'узкий review 06/T1j5-Б1: пункт уже исправлен предыдущим патчем, осталось 1 пунктов',
    );
    expect(run.lines).not.toContain(expect.stringContaining('жду:'));
  });

  it('после красного CI повторно публикует исправленный HEAD без ложного конфликта origin', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
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
      '$spec 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$task 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.prompts[3]).toContain('КОД: CI точного SHA красный');
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

  it('передаёт замечание кодера СПЕК отдельному автору тестов', async () => {
    const run = await runWorld({
      spec: true,
      sessions: [
        {
          answer: 'Приёмочный тест записан.',
          writes: { 'packages/sim/test/task.test.ts': "it('критерий', () => {});\n" },
          push: false,
        },
        { answer: 'СПЕК: packages/sim/test/task.test.ts:1 — проверяется неверное значение' },
        {
          answer: 'Тест исправлен.\nРЕМОНТ: ИСПРАВЛЕНО\nСПЕК: packages/sim/test/task.test.ts',
          writes: { 'packages/sim/test/task.test.ts': "it('верный критерий', () => {});\n" },
          commit: true,
          push: false,
        },
        review('OK'),
        codeCommit(),
        review('OK'),
      ],
      ci: ['success https://ci/task', 'success https://ci/docs'],
    });

    expect(run.prompts[2]).toContain('$spec 06/T1j5-Б1');
    expect(run.prompts[2]).toContain('ТЕСТ: неверный приёмочный тест');
    expect(run.lines).not.toContain('нужен ответ владельца');
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
