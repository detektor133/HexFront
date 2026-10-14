import { describe, expect, it } from 'vitest';

import { Board, MAIN_AGENT } from './board.ts';
import { closeAll, fixtureStage, fixtureStatus, runWorld, type Session } from './test-world.ts';

const NEXT_DONE: Session = {
  task: 'T1j5-Б1',
  mark: '~',
  answer: 'Готово.\nЗапусти `$review 06/T1j5-Б1` в новой сессии',
};
const REVIEW_OK: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK\nвсё подтверждено' };
const FIXED: Session = { answer: 'slow починен', commit: true };
const RED = 'failure job=tests https://slow/2';

describe('workflow slow (все тесты)', () => {
  it('не ждёт идущий slow: задача и ревью идут сразу', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE, REVIEW_OK],
      slow: ['pending https://slow/2 40'],
    });
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
    expect(run.slowCalls[0]).toBe('--workflow=slow.yml --once');
  });

  it('красный slow чинит задача из трейлера HEAD до новой задачи', async () => {
    const run = await runWorld({
      sessions: [FIXED, NEXT_DONE, REVIEW_OK],
      slow: [RED],
      headTrailer: '06/T1e\n',
    });
    expect(run.prompts).toEqual([
      `$task 06/T1e CI красный: slow ${RED}`,
      '$next',
      '$review 06/T1j5-Б1',
    ]);
    expect(run.lines).toContain(`красный slow (все тесты): ${RED} — исправляет 06/T1e`);
  });

  it('служебный коммит без задачи в трейлере — к владельцу, без сессий', async () => {
    const run = await runWorld({ sessions: [], slow: [RED], headTrailer: '06/infra\n' });
    expect(run.prompts).toEqual([]);
    const waiting = run.lines.find((line) => line.startsWith('жду: красный slow'));
    expect(waiting).toContain('на служебном коммите');
    expect(waiting).toContain('«Re-run failed jobs»');
    expect(waiting).toContain('перешли ссылку Claude');
    expect(waiting).toContain(RED);
  });

  it('красный slow, перезапущенный на GitHub, зеленеет на том же HEAD — цикл продолжает сам', async () => {
    // 2026-10-14: прогон slow упал на SIGSEGV воркера vitest; после «Re-run failed jobs»
    // цикл ждал нового коммита, хотя HEAD тот же и slow уже зелёный.
    const run = await runWorld({
      sessions: [NEXT_DONE, REVIEW_OK],
      slow: [RED, 'success https://slow/3'],
      headTrailer: '06/infra\n',
      polls: 1,
      wake: true,
    });
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
  });

  it('перезапущенный прогон ещё идёт — ожидание снято: баннер не зовёт владельца, работа идёт', async () => {
    const board = new Board(Date.now);
    const run = await runWorld({
      board,
      sessions: [NEXT_DONE, REVIEW_OK],
      slow: [RED, 'pending https://slow/2 1'],
      headTrailer: '06/infra\n',
      polls: 1,
      wake: true,
    });
    expect(run.lines.some((line) => line.startsWith('ожидание снялось само: slow:'))).toBe(true);
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
    // Дальше очередь может ждать владельца по другой причине, но не по красному slow.
    expect(board.agents().find((agent) => agent.name === MAIN_AGENT)?.text).not.toMatch(
      /красный slow/u,
    );
  });

  it('второй красный slow после исправления той же задачи — к владельцу', async () => {
    const run = await runWorld({
      sessions: [FIXED],
      slow: [RED, RED],
      headTrailer: '06/T1e',
    });
    expect(run.prompts).toEqual([`$task 06/T1e CI красный: slow ${RED}`]);
    expect(
      run.lines.some((line) =>
        line.startsWith('жду: slow снова красный после исправления 06/T1e. Открой ссылку'),
      ),
    ).toBe(true);
  });

  it('непроверенный slow (сеть) работу не держит', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE, REVIEW_OK],
      slow: ['error сеть: TypeError: fetch failed'],
    });
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
  });
});

describe('slow перед $stage-close', () => {
  const lastQueue = fixtureStatus.replace(/Очередь:.*/, 'Очередь: 06/T2');
  const closedStatus = lastQueue.replace('| 06 —', '| 07 —');

  it('этап закрывается только после зелёного slow, дождавшись его', async () => {
    const run = await runWorld({
      status: lastQueue,
      stage: closeAll(fixtureStage),
      // Шаг очереди видит идущий прогон, закрытие этапа ждёт его до конца.
      slow: ['pending https://slow/3 10', 'success https://slow/3'],
      sessions: [{ answer: 'Этап 06 закрыт', status: closedStatus }],
    });
    expect(run.prompts).toEqual(['$stage-close']);
    expect(run.slowCalls[1]).toBe('--workflow=slow.yml --timeout-minutes=25');
    expect(run.lines).toContain('slow зелёный за 0 мин: success https://slow/3');
  });

  it('красный slow перед закрытием — исправление, а не $stage-close', async () => {
    const run = await runWorld({
      status: lastQueue,
      stage: closeAll(fixtureStage),
      slow: ['pending https://slow/3 10', RED, RED, RED],
      headTrailer: '06/T2',
      sessions: [FIXED],
    });
    expect(run.prompts[0]).toBe(`$task 06/T2 CI красный: slow ${RED}`);
    expect(run.prompts).not.toContain('$stage-close');
  });
});
