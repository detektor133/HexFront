import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { parseIssueCommand } from './github.ts';
import { closedStageBranch, statusStage } from './stage-file.ts';
import { closeAll, fixtureStage, fixtureStatus, issue, runWorld, setMark } from './test-world.ts';

const ownerParked = setMark(fixtureStage, 'T1j5-Б1', 'x');
const DECIDE = '$decide\nT1i выполнена владельцем.\nВторая строка решения дословно.';

describe('команда в теле Issue', () => {
  it('читает команду первой строки и оставляет тело дословно', () => {
    expect(parseIssueCommand(`${DECIDE}\r\n`)).toEqual({ skill: 'decide', prompt: DECIDE });
    expect(parseIssueCommand('$done 06/T1i веса после 30 поколений')).toEqual({
      skill: 'done',
      task: '06/T1i',
      prompt: '$done 06/T1i веса после 30 поколений',
    });
    expect(parseIssueCommand('$stage-close')).toEqual({
      skill: 'stage-close',
      prompt: '$stage-close',
    });
  });

  it('$streams N — число задач одновременно от 1 до 4', () => {
    expect(parseIssueCommand('$streams 2')).toEqual({
      skill: 'streams',
      count: 2,
      prompt: '$streams 2',
    });
    for (const body of ['$streams', '$streams 0', '$streams 5', '$streams два', '$streams 1.5'])
      expect(parseIssueCommand(body)).toHaveProperty('error');
  });

  it('отклоняет тело без команды, без номера задачи или без текста', () => {
    expect(parseIssueCommand('сделай боты умнее')).toHaveProperty('error');
    expect(parseIssueCommand('$deploy 06/T1')).toHaveProperty('error');
    expect(parseIssueCommand('$task')).toHaveProperty('error');
    expect(parseIssueCommand('$decide   ')).toHaveProperty('error');
  });
});

describe('Issues в цикле', () => {
  it('исполняет Issue владельца до очереди, отвечает и закрывает её', async () => {
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(5, DECIDE)],
      sessions: [{ answer: 'Изменены STATUS и файл этапа', status: fixtureStatus }],
    });
    expect(run.prompts).toEqual([DECIDE]);
    expect(run.roles).toEqual(['']);
    expect(run.closed).toEqual([5]);
    expect(run.comments[0]).toMatch(/^#5: выполнено: коммит c1 — Изменены STATUS/);
  });

  it('не исполняет Issue чужого автора и Issue с меткой agent-stop', async () => {
    const stopped = { ...issue(6, DECIDE), labels: ['agent', 'agent-stop'] };
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(5, DECIDE, 'stranger'), stopped],
      sessions: [],
    });
    expect(run.prompts).toEqual([]);
    expect(run.comments).toEqual([]);
  });

  it('на тело без команды отвечает и ставит agent-stop, codex не запускает', async () => {
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(7, 'боты тупые')],
      sessions: [],
    });
    expect(run.prompts).toEqual([]);
    expect(run.labels).toEqual(['#7: agent-stop']);
    expect(run.comments[0]).toMatch(/^#7: стоп: первая строка тела должна быть командой/);
  });

  it('скилл без коммита — agent-stop с ответом скилла, очередь продолжается', async () => {
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(8, DECIDE)],
      sessions: [{ answer: 'Конфликт с 05-armies.md: решение противоречит п.3' }],
    });
    expect(run.labels).toEqual(['#8: agent-stop']);
    expect(run.comments[0]).toContain('Конфликт с 05-armies.md');
    expect(run.closed).toEqual([]);
  });

  it('отстающий список GitHub не исполняет закрытую или остановленную Issue второй раз', async () => {
    const run = await runWorld({
      stage: ownerParked,
      staleList: true,
      issues: [issue(5, DECIDE), issue(7, 'боты тупые')],
      sessions: [{ answer: 'Изменены STATUS и файл этапа', status: fixtureStatus }],
    });
    expect(run.prompts).toEqual([DECIDE]);
    expect(run.closed).toEqual([5]);
    expect(run.labels).toEqual(['#7: agent-stop']);
    expect(run.comments).toHaveLength(2);
  });

  it('список с новым updated_at от ответа цикла не исполняет закрытую Issue второй раз', async () => {
    // 2026-10-14: #12 закрыта и прокомментирована, а список через 4 с отдал её открытой
    // с новым updated_at — $decide запустился второй раз.
    const run = await runWorld({
      stage: ownerParked,
      staleList: 'bumped',
      issues: [issue(5, DECIDE), issue(7, 'боты тупые')],
      sessions: [{ answer: 'Изменены STATUS и файл этапа', status: fixtureStatus }],
    });
    expect(run.prompts).toEqual([DECIDE]);
    expect(run.closed).toEqual([5]);
    expect(run.labels).toEqual(['#7: agent-stop']);
    expect(run.comments).toHaveLength(2);
  });

  it('выполняет свежий текст Issue, даже если список GitHub отстал', async () => {
    const changed = '$decide\nНовое решение владельца.';
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(20, DECIDE)],
      freshIssues: [{ ...issue(20, changed), updatedAt: '2026-10-18T04:00:00Z' }],
      sessions: [{ answer: 'Новое решение записано', status: fixtureStatus }],
    });
    expect(run.prompts).toEqual([changed]);
    expect(run.closed).toEqual([20]);
    expect(run.lines.some((line) => line.includes('sha256='))).toBe(true);
  });

  it('не исполняет Issue, если в свежем ответе снята метка agent или изменён автор', async () => {
    const candidates = [{ ...issue(21, DECIDE), labels: [] }, issue(21, DECIDE, 'stranger')];
    for (const fresh of candidates) {
      const run = await runWorld({
        stage: ownerParked,
        issues: [issue(21, DECIDE)],
        freshIssues: [fresh],
        sessions: [],
      });
      expect(run.prompts).toEqual([]);
      expect(run.closed).toEqual([]);
    }
  });

  it('не закрывает Issue с непроверенным CI', async () => {
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(22, DECIDE)],
      ci: ['network error', 'network error'],
      sessions: [{ answer: 'Коммит создан', status: fixtureStatus }],
    });
    expect(run.closed).toEqual([]);
    expect(run.labels).toContain('#22: agent-stop');
    expect(run.comments[0]).toContain('CI не проверен');
  });

  it('прямой $plan из Issue ограничен правами plan', async () => {
    const run = await runWorld({
      stage: ownerParked,
      plan: true,
      issues: [issue(23, '$plan\nДобавь задачи этапа.')],
      sessions: [
        {
          answer: 'PLAN: уточнено',
          writes: { 'packages/sim/src/step.ts': 'export {};\n' },
          commit: true,
          files: ['packages/sim/src/step.ts'],
        },
      ],
    });
    expect(run.closed).toEqual([]);
    expect(run.labels).toContain('#23: agent-stop');
    expect(run.comments[0]).toContain('вне permissions.json');
  });

  it('$task из Issue проходит $plan перед реализацией без автоматического $spec', async () => {
    const run = await runWorld({
      stage: ownerParked,
      plan: true,
      issues: [issue(24, '$task 06/T2')],
      sessions: [
        { answer: 'PLAN: не трогал' },
        { task: 'T2', mark: '~', answer: 'Готово' },
        { task: 'T2', mark: 'x', answer: 'OK' },
      ],
    });
    expect(run.prompts).toEqual(['$plan 06/T2', '$task 06/T2', '$review 06/T2']);
    expect(run.locked).toEqual(['', '', '']);
    expect(run.closed).toEqual([24]);
  });

  it('$task из Issue после разбиения plan не исполняет старого родителя', async () => {
    const splitStage = fixtureStage.replace(
      '- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).\n  *Приёмка:* тесты.',
      '- [ ] **T1j5-Б1. Фитнес по метрикам самой особи** (tools/evolve).\n  *Приёмка:* тесты.\n' +
        '- [ ] **T1j5-Б1a. Часть 1** (tools/evolve), задача владельца.\n  *Приёмка:* тесты.\n' +
        '- [ ] **T1j5-Б1b. Часть 2** (tools/evolve), задача владельца.\n  *Проверка:* интеграция.',
    );
    const splitStatus = fixtureStatus.replace(
      'Очередь: 06/T1j5-Б1 →',
      'Очередь: 06/T1j5-Б1a → 06/T1j5-Б1b →',
    );
    const run = await runWorld({
      stage: fixtureStage,
      plan: true,
      issues: [issue(29, '$task 06/T1j5-Б1')],
      sessions: [{ answer: 'PLAN: разбито', stage: splitStage, status: splitStatus }],
    });
    expect(run.prompts).toEqual(['$plan 06/T1j5-Б1']);
    expect(run.closed).toContain(29);
    expect(run.lines.some((line) => line.includes('дочерние задачи поставлены в очередь'))).toBe(
      true,
    );
  });

  it('$decide не закрывает Issue, если пункт отсутствует в своей задаче', async () => {
    const body = '$decide\n## T2 — интерфейс\nПоказать кнопку и полный счёт.\n';
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(25, body)],
      sessions: [{ answer: 'Перенёс решение', status: fixtureStatus }],
    });
    expect(run.closed).toEqual([]);
    expect(run.labels).toContain('#25: agent-stop');
    expect(run.comments[0]).toContain('сверка требований не пройдена');
  });

  it('$decide закрывает Issue, если все пункты лежат в своих задачах', async () => {
    const body = '$decide\n## T2 — интерфейс\nПоказать кнопку и полный счёт.\n';
    const updated = ownerParked.replace(
      '- [ ] **T2. Итерации баланса**.',
      '- [ ] **T2. Итерации баланса**.\nПоказать кнопку и полный счёт.',
    );
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(26, body)],
      sessions: [{ answer: 'Перенёс решение', stage: updated }],
    });
    expect(run.closed).toEqual([26]);
    expect(run.lines.some((line) => line.includes('сверено 1 пунктов'))).toBe(true);
  });

  it('$split из Issue не подтверждается при потере исходного критерия', async () => {
    const bad = ownerParked.replace(
      '- [ ] **T2. Итерации баланса**.',
      '- [ ] **T2. Итерации баланса**.\n' + '- [ ] **T2a. Часть 1**.\n' + '- [ ] **T2b. Часть 2**.',
    );
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(27, '$split 06/T2')],
      sessions: [{ answer: 'Разбито', stage: bad }],
    });
    expect(run.closed).toEqual([]);
    expect(run.labels).toContain('#27: agent-stop');
    expect(run.comments[0]).toContain('сверка требований не пройдена');
  });

  it('$task из Issue идёт кругами до [x] и закрывает Issue', async () => {
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(9, '$task 06/T2')],
      sessions: [
        { task: 'T2', mark: '~', answer: 'Готово' },
        { task: 'T2', mark: 'x', answer: 'OK' },
      ],
    });
    expect(run.prompts).toEqual(['$task 06/T2', '$review 06/T2']);
    expect(run.closed).toEqual([9]);
  });

  it('$task из Issue передаёт исполнителю текст владельца, и после ВОЗВРАТ тоже', async () => {
    const body = '$task 06/T2\nПервым — живой фон меню: снимки фонового Worker идут в карту.';
    const run = await runWorld({
      stage: ownerParked,
      issues: [issue(12, body)],
      sessions: [
        { task: 'T2', mark: '~', answer: 'Готово' },
        { task: 'T2', mark: ' ', answer: 'ВОЗВРАТ\n- MainMenu.tsx:41 — фон не рисуется' },
        { task: 'T2', mark: '~', answer: 'Готово' },
        { task: 'T2', mark: 'x', answer: 'OK' },
      ],
    });
    expect(run.prompts[0]).toBe(body);
    expect(run.prompts[2]).toContain('Первым — живой фон меню');
    expect(run.closed).toEqual([12]);
  });

  it('$review из Issue передаёт исполнителю дословный возврат', async () => {
    const run = await runWorld({
      stage: setMark(ownerParked, 'T2', '~'),
      issues: [issue(13, '$review 06/T2\nпосмотри внимательнее')],
      sessions: [
        { task: 'T2', mark: ' ', answer: 'ВОЗВРАТ\n- a.ts:1 — нет проверки' },
        { task: 'T2', mark: '~', answer: 'Готово' },
        { task: 'T2', mark: 'x', answer: 'OK' },
      ],
    });
    expect(run.prompts[1]).toContain('$task 06/T2 исправить возврат ревью');
    expect(run.prompts[1]).toContain('a.ts:1 — нет проверки');
  });

  it('при грязном дереве (работа владельца) исполняет только $done', async () => {
    const run = await runWorld({
      stage: ownerParked,
      dirty: true,
      issues: [issue(10, DECIDE), issue(11, '$done 06/T1i 30 поколений, веса лучшей особи')],
      sessions: [
        { task: 'T1i', mark: 'x', answer: 'Закоммичены веса, T1i [x]' },
        { answer: 'ok', status: fixtureStatus },
        { answer: 'T1e ждёт приёмки владельца' },
      ],
    });
    // Затем очередь идёт дальше: T1i закрыта, следующая — T1e.
    expect(run.prompts).toEqual(['$done 06/T1i 30 поколений, веса лучшей особи', DECIDE, '$next']);
    expect(run.closed).toEqual([11, 10]);
  });
});

describe('$streams в цикле', () => {
  it('исполняется и при грязном дереве: это настройка цикла, а не работа в дереве', async () => {
    const run = await runWorld({
      stage: ownerParked,
      dirty: true,
      issues: [issue(7, '$streams 1')],
      sessions: [],
    });
    expect(run.prompts).toEqual([]);
    expect(run.closed).toEqual([7]);
    expect(run.comments.some((text) => text.includes('один агент'))).toBe(true);
  });
});

describe('закрытие этапа', () => {
  const lastQueue = fixtureStatus.replace(/Очередь:.*/, 'Очередь: 06/T2');

  it('при пустой очереди и закрытом этапе запускает $stage-close и открывает PR', async () => {
    const closedStatus = lastQueue.replace('| 06 —', '| 07 —');
    const run = await runWorld({
      status: lastQueue,
      stage: closeAll(fixtureStage),
      sessions: [{ answer: 'Этап 06 закрыт', status: closedStatus }],
    });
    expect(run.prompts).toEqual(['$stage-close']);
    expect(run.pulls).toEqual(['stage-06 → main']);
    expect(run.lines.some((line) => line.startsWith('жду: этап закрыт, PR https://'))).toBe(true);
  });

  it('после мержа PR $stage-close создаёт ветку следующего этапа', async () => {
    const closedStatus = lastQueue.replace('| 06 —', '| 07 —');
    const nextStatus = closedStatus
      .replace('stage-06', 'stage-07')
      .replace(/Очередь:.*/, 'Очередь: 07/T1');
    const run = await runWorld({
      status: closedStatus,
      stage: closeAll(fixtureStage),
      merged: true,
      sessions: [
        { answer: 'Ветка stage-07 создана', status: nextStatus, branch: 'stage-07' },
        { answer: 'дошла до 07/T1', commit: false },
      ],
    });
    expect(run.prompts).toEqual(['$stage-close', '$next']);
    expect(run.lines).toContain('новый этап: ветка stage-07');
  });

  it('если $stage-close не сменил этап, ждёт и не закрывает этап по кругу', async () => {
    const run = await runWorld({
      status: lastQueue,
      stage: closeAll(fixtureStage),
      sessions: [{ answer: 'Этап закрыт', commit: true }],
    });
    expect(run.prompts).toEqual(['$stage-close']);
    expect(run.lines).toContain(
      'жду: $stage-close не перевёл «Текущий этап» в STATUS на следующий — проверь',
    );
  });

  it('после неудачного шага 7 не запускает $stage-close снова без нового коммита', async () => {
    const closedStatus = lastQueue.replace('| 06 —', '| 07 —');
    const run = await runWorld({
      status: closedStatus,
      stage: closeAll(fixtureStage),
      merged: true,
      polls: 2,
      wake: true,
      sessions: [{ answer: 'Ветка stage-07 уже есть' }],
    });
    expect(run.prompts).toEqual(['$stage-close']);
  });

  it('$stage-close записал STATUS своей таблицей — ожидание с причиной, а не ошибка на каждом шаге', async () => {
    // Таблица из коммита 6dcccf2 (2026-10-14): цикл не находил «Текущий этап» и сыпал ошибками.
    const own = lastQueue.replace(
      /\| Текущий этап[^\n]*\n\| Ветка[^\n]*\n/,
      '| Этап | Ветка | Дата |\n| --- | --- | --- |\n| 06 закрыт — Боты и баланс | `stage-06` | 2026-10-14 |\n',
    );
    const run = await runWorld({
      status: lastQueue,
      stage: closeAll(fixtureStage),
      polls: 2,
      sessions: [{ answer: 'Этап 06 закрыт', status: own }],
    });
    expect(run.prompts).toEqual(['$stage-close']);
    expect(
      run.lines.filter((line) => line.startsWith('жду: $stage-close записал STATUS')),
    ).toHaveLength(1);
    expect(run.lines.some((line) => line.startsWith('ошибка'))).toBe(false);
  });

  it('шаблон таблицы STATUS в скилле $stage-close цикл читает как закрытый этап', async () => {
    const skill = await readFile(
      new URL('../../../.agents/skills/stage-close/SKILL.md', import.meta.url),
      'utf8',
    );
    const template = skill.match(/```\n(\| Поле[\s\S]*?)```/)?.[1] ?? '';
    const status = template
      .replace('<NN+1>', '07')
      .replace('<NN>', '06')
      .replace(/<[^>]+>/g, 'текст');
    expect(statusStage(status)).toBe('07');
    expect(closedStageBranch(status)).toBe('stage-06');
  });

  it('пустая очередь при открытых задачах этапа — ожидание, а не $stage-close', async () => {
    const run = await runWorld({
      status: lastQueue,
      stage: setMark(fixtureStage, 'T2', 'x'),
      sessions: [],
    });
    expect(run.prompts).toEqual([]);
    expect(run.lines.some((line) => line.startsWith('жду: в очереди нет открытых задач'))).toBe(
      true,
    );
  });
});
