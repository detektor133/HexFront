import { describe, expect, it } from 'vitest';

import { defaultRunCommand, prepareProcessArguments } from './agent-loop.ts';
import {
  closedStageBranch,
  commandTask,
  isOwnerTask,
  parseQueue,
  selectTask,
  taskMark,
} from './stage-file.ts';
import {
  fixtureStage,
  fixtureStatus,
  issue,
  runWorld,
  setMark,
  type Session,
} from './test-world.ts';

const NEXT_DONE: Session = {
  task: 'T1j5-Б1',
  mark: '~',
  answer: 'Готово.\nЗапусти `$review 06/T1j5-Б1` в новой сессии',
};
const REVIEW_OK: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK\nвсё подтверждено' };
const REVIEW_BACK: Session = {
  task: 'T1j5-Б1',
  mark: ' ',
  answer: 'ВОЗВРАТ\n- п.1 — evaluate.ts:95 — штраф по чужим метрикам',
};
const OWNER_WAIT =
  'жду: очередь дошла до 06/T1i — это задача владельца. Когда сделаешь — Issue «$done 06/T1i» с текстом, что сделано';

describe('разбор файла этапа', () => {
  it('выбирает первую незакрытую задачу очереди, включая [~]', () => {
    expect(selectTask(fixtureStatus, fixtureStage)).toBe('06/T1j5-Б1');
    expect(selectTask(fixtureStatus, setMark(fixtureStage, 'T1j5-Б1', 'x'))).toBe('06/T1i');
    expect(selectTask(fixtureStatus, setMark(fixtureStage, 'T1j5-Б1', '~'))).toBe('06/T1j5-Б1');
  });

  it('берёт из «Очереди» только номера задач, без пояснений', () => {
    expect(parseQueue('Очередь: 07/T1 после мержа PR этапа 06; новый этап не начат.')).toEqual([
      '07/T1',
    ]);
    expect(parseQueue('Очередь: 06/T1j7 → 06/T1i → 06/T1e → 06/T2')).toHaveLength(4);
  });

  it('не путает T1 с T1i и T1e при чтении отметки', () => {
    const stage = setMark(fixtureStage, 'T1i', 'x');
    expect(taskMark(stage, '06/T1')).toBe(' ');
    expect(taskMark(stage, '06/T1i')).toBe('x');
    expect(taskMark(stage, '06/T9')).toBeUndefined();
  });

  it('считает задачей владельца только первую строку без «не задача владельца»', () => {
    expect(isOwnerTask('- [ ] **T1i. Обучение весов**, задача владельца.')).toBe(true);
    expect(isOwnerTask('- [ ] **T8. Плейтест**')).toBe(true);
    expect(
      isOwnerTask('- [ ] **T1e. Проверка**, не задача владельца.\n  после $accept 06/T1'),
    ).toBe(false);
  });

  it('находит номер задачи после команды в ответе, без кавычек и точки', () => {
    expect(commandTask('запусти `$split 06/T1j5-Б1`.', '$split')).toBe('06/T1j5-Б1');
    expect(commandTask('нужен $accept 06/T1.', '$accept')).toBe('06/T1');
    expect(commandTask('нужен $accept', '$accept')).toBeUndefined();
  });

  it('видит закрытый этап: «Текущий этап» уже следующий, а «Ветка» прежняя', () => {
    expect(closedStageBranch(fixtureStatus)).toBeUndefined();
    expect(closedStageBranch(fixtureStatus.replace('| 06 —', '| 07 —'))).toBe('stage-06');
  });
});

describe('круги $next → CI → $review', () => {
  it('проходит задачу за круг и ждёт на задаче владельца, не вызывая codex', async () => {
    const run = await runWorld({ sessions: [NEXT_DONE, REVIEW_OK] });
    expect(run.code).toBe(0);
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
    expect(run.roles).toEqual(['', 'reviewer']);
    expect(run.ciCalls).toBe(1);
    // Перед ревью — и остальные workflow HEAD (2026-10-14: сломанный pages.yml 07/T4 прошёл ревью).
    expect(run.ciArgs).toEqual(['--all-workflows']);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
    expect(run.lines).toContain(OWNER_WAIT);
  });

  it('передаёт модель только если она задана, и усилие medium', async () => {
    const run = await runWorld({ sessions: [NEXT_DONE, REVIEW_OK] });
    // На Windows аргументы приходят в кавычках для cmd, поэтому сравнение — без них.
    const plain = run.codexArguments.map((args) => args.map((arg) => arg.replace(/^"|"$/g, '')));
    expect(plain[0]).toEqual(
      expect.arrayContaining(['--model', 'luna', 'model_reasoning_effort=medium']),
    );
    expect(plain[1]).not.toContain('--model');
  });

  it('после ВОЗВРАТ снова запускает $next и затем $review', async () => {
    const run = await runWorld({ sessions: [NEXT_DONE, REVIEW_BACK, NEXT_DONE, REVIEW_OK] });
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1', '$next', '$review 06/T1j5-Б1']);
    expect(run.lines).toContain('ВОЗВРАТ 06/T1j5-Б1, круг 1 из 3');
  });

  it('после maxRounds ВОЗВРАТ ждёт владельца и не начинает задачу заново', async () => {
    const run = await runWorld({
      maxRounds: 2,
      sessions: [NEXT_DONE, REVIEW_BACK, NEXT_DONE, REVIEW_BACK],
    });
    expect(run.prompts).toHaveLength(4);
    expect(run.lines).toContain('жду: 2 ВОЗВРАТ подряд по 06/T1j5-Б1 — нужно решение владельца');
  });

  it('начинает с $review, если задача уже [~], но сначала проверяет CI её HEAD', async () => {
    const run = await runWorld({
      stage: setMark(fixtureStage, 'T1j5-Б1', '~'),
      sessions: [REVIEW_OK],
    });
    expect(run.prompts).toEqual(['$review 06/T1j5-Б1']);
    expect(run.ciCalls).toBe(1);
  });

  it('при красном CI запускает $task с причиной, а не $next', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE, { answer: 'CI починен, задача ждёт ревью', commit: true }, REVIEW_OK],
      ci: [
        'failure job=check https://ci/2\n ELIFECYCLE  Command failed with exit code 1.',
        'success https://ci/3',
      ],
    });
    expect(run.prompts).toEqual([
      '$next',
      '$task 06/T1j5-Б1 CI красный: failure job=check https://ci/2',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain('CI красный за 0 мин: failure job=check https://ci/2');
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('недоступный GitHub не считает красным CI: пауза без ревью и без новой работы', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE],
      ci: ['error сеть: TypeError: fetch failed', 'error сеть: TypeError: fetch failed'],
    });
    expect(run.prompts).toEqual(['$next']);
    expect(run.ciCalls).toBe(2);
    expect(run.lines).toContain(
      'сбой: CI 06/T1j5-Б1 не проверен: error сеть: TypeError: fetch failed — следующая попытка через 30 мин',
    );
  });

  it('повторяет ожидание CI один раз после таймаута', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE, REVIEW_OK],
      ci: ['failure timeout https://ci/3', 'success https://ci/3'],
    });
    expect(run.ciCalls).toBe(2);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('сам пушит коммит, который сессия не запушила', async () => {
    const run = await runWorld({ sessions: [{ ...NEXT_DONE, push: false }, REVIEW_OK] });
    expect(run.pushes).toBe(1);
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('ждёт владельца без отката, если запушенное ревью изменило код', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE, { ...REVIEW_OK, files: ['packages/sim/src/step.ts'] }],
    });
    expect(run.lines).toContain('жду: ревью изменило файлы вне permissions.json — проверь коммит');
  });

  it('принимает вердикт ревью в оформлении `OK` и **OK**', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE, { ...REVIEW_OK, answer: '**OK** — всё подтверждено' }],
    });
    expect(run.lines).toContain('готово: 06/T1j5-Б1');
  });

  it('доделка начинается с работы, даже если в незакоммиченном файле уже [~]', async () => {
    const run = await runWorld({
      dirty: true,
      resume: '06/T1j5-Б1',
      stage: setMark(fixtureStage, 'T1j5-Б1', '~'),
      sessions: [{ ...NEXT_DONE, commit: true }, REVIEW_OK],
    });
    expect(run.prompts).toEqual(['$task 06/T1j5-Б1 продолжить', '$review 06/T1j5-Б1']);
  });

  it('ждёт владельца, если ответ ревью не совпадает с отметкой', async () => {
    const run = await runWorld({ sessions: [NEXT_DONE, { ...REVIEW_OK, mark: ' ' }] });
    expect(run.lines).toContain('жду: ответ $review «OK» не совпадает с отметкой [ ]');
  });

  it('при сбое codex делает паузу и больше сессий не запускает', async () => {
    const run = await runWorld({ sessions: [{ answer: 'процесс упал', code: 1 }] });
    expect(run.prompts).toEqual(['$next']);
    expect(run.lines).toContain(
      'сбой: $next: codex завершился с кодом 1 — следующая попытка через 30 мин',
    );
  });

  it('считает сбоем исчерпанный лимит Codex даже при коде 0', async () => {
    const run = await runWorld({
      sessions: [{ answer: "You've hit your usage limit. Try again in 3 hours." }],
    });
    expect(run.prompts).toEqual(['$next']);
    expect(run.lines).toContain(
      'сбой: $next: кончился лимит Codex — следующая попытка через 30 мин',
    );
  });

  it('--resume в чистом дереве забывается и не продолжает чужую работу', async () => {
    const run = await runWorld({ resume: '06/T1j5-Б1', sessions: [NEXT_DONE, REVIEW_OK] });
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
  });

  it('ждёт, если ветка не совпадает с «Ветка» в STATUS', async () => {
    const run = await runWorld({ branch: 'main', sessions: [] });
    expect(run.prompts).toEqual([]);
    expect(run.lines).toContain('жду: ожидалась ветка stage-06 из STATUS, сейчас main');
  });

  it('в --dry-run только печатает план', async () => {
    const run = await runWorld({ dryRun: true, sessions: [] });
    expect(run.lines).toEqual(['$next → CI → $review: 06/T1j5-Б1']);
  });
});

describe('$split, $accept и доделка без владельца', () => {
  it('запускает $split по ответу $next и снова берёт очередь', async () => {
    const split = { answer: 'Задача велика: запусти `$split 06/T1j5-Б1`.' };
    const run = await runWorld({
      sessions: [split, { answer: 'Разбито на T1j5-Б1a…', commit: true }, split],
    });
    expect(run.prompts).toEqual(['$next', '$split 06/T1j5-Б1', '$next']);
    expect(run.lines).toContain('жду: 06/T1j5-Б1 снова просят разбить — нужен владелец');
  });

  it('запускает $accept по ответу $next и повторяет $next с результатом приёмки', async () => {
    const stage = setMark(setMark(fixtureStage, 'T1j5-Б1', 'x'), 'T1i', 'x');
    const run = await runWorld({
      stage,
      sessions: [
        { answer: 'Приёмка требует `$accept 06/T1`, задача оставлена [ ]' },
        { answer: 'выполнено 3/3', commit: true },
        { task: 'T1e', mark: '~', answer: 'Готово' },
        { task: 'T1e', mark: 'x', answer: 'OK' },
      ],
    });
    expect(run.prompts).toEqual(['$next', '$accept 06/T1', '$next', '$review 06/T1e']);
    expect(run.lines).toContain('готово: 06/T1e');
  });

  it('второй раз $accept в тех же кругах не запускает, а ждёт владельца', async () => {
    const stage = setMark(setMark(fixtureStage, 'T1j5-Б1', 'x'), 'T1i', 'x');
    const ask = { answer: 'Приёмка `$accept 06/T1` не пройдена, нужен новый evolve' };
    const run = await runWorld({ stage, sessions: [ask, { answer: '1/3', commit: true }, ask] });
    expect(run.prompts).toEqual(['$next', '$accept 06/T1', '$next']);
    expect(run.lines.some((line) => line.startsWith('жду: 06/T1e не отмечена [~]'))).toBe(true);
  });

  it('доделывает незакоммиченную работу одной сессией «продолжить»', async () => {
    const run = await runWorld({
      sessions: [{ answer: 'verify красный', dirty: true }, NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts).toEqual(['$next', '$task 06/T1j5-Б1 продолжить', '$review 06/T1j5-Б1']);
  });

  it('ждёт владельца, если и доделка оставила дерево грязным', async () => {
    const run = await runWorld({
      sessions: [
        { answer: 'verify красный', dirty: true },
        { answer: 'снова красный', dirty: true },
      ],
    });
    expect(run.prompts).toHaveLength(2);
    expect(run.lines).toContain(
      'жду: 06/T1j5-Б1 ждёт твоего ответа: «снова красный». Ответ — Issue «$decide» с решением; работа задачи останется и продолжится сама',
    );
  });

  it('по --resume начинает с доделки задачи в грязном дереве', async () => {
    const run = await runWorld({
      dirty: true,
      resume: '06/T1j5-Б1',
      sessions: [NEXT_DONE, REVIEW_OK],
    });
    expect(run.prompts).toEqual(['$task 06/T1j5-Б1 продолжить', '$review 06/T1j5-Б1']);
  });

  it('чужое грязное дерево не трогает: ждёт $done или --resume', async () => {
    const run = await runWorld({ dirty: true, sessions: [] });
    expect(run.prompts).toEqual([]);
    expect(run.lines.some((line) => line.startsWith('жду: рабочее дерево не чистое'))).toBe(true);
  });
});

describe('ожидание', () => {
  it('без работы спит и проверяет снова, сообщение об ожидании — один раз', async () => {
    const run = await runWorld({
      stage: setMark(fixtureStage, 'T1j5-Б1', 'x'),
      sessions: [],
      polls: 2,
    });
    expect(run.prompts).toEqual([]);
    expect(run.lines.filter((line) => line === OWNER_WAIT)).toHaveLength(1);
    expect(run.lines.filter((line) => line.startsWith('… жду:'))).toHaveLength(1);
    expect(run.checks).toBe(run.sleeps + 1);
  });

  it('новую Issue берёт на следующей дешёвой проверке, а не через полный интервал', async () => {
    const run = await runWorld({
      stage: setMark(fixtureStage, 'T1j5-Б1', 'x'),
      polls: 3,
      arrival: issue(12, '$done 06/T1i плейтест пройден'),
      sessions: [{ task: 'T1i', mark: 'x', answer: 'T1i [x]' }, { answer: 'T1e ждёт $accept' }],
    });
    expect(run.sleepsAtPrompt[0]).toBe(1);
    expect(run.lines).toContain('изменения в Issues или main — проверяю');
    expect(run.prompts.slice(0, 2)).toEqual(['$done 06/T1i плейтест пройден', '$next']);
  });
});

describe('запуск процесса', () => {
  it('передаёт спецсимволы stdin подменённому процессу без изменений', async () => {
    const input = 'строка "кавычки" $next & | > <\nвторая строка';
    // Команда без пути: на Windows cmd разрезал бы `C:\Program Files\…\node.exe` по пробелу.
    const result = await defaultRunCommand(
      'node',
      prepareProcessArguments(['-e', 'process.stdin.pipe(process.stdout)']),
      { input },
    );
    expect(result.stdout).toBe(input);
  });
});
