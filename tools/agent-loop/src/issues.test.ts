import { describe, expect, it } from 'vitest';

import { parseIssueCommand } from './github.ts';
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
