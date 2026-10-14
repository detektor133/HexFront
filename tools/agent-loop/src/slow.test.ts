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
const RED_RUN = 'failure job=tests https://github.com/detektor133/HexFront/actions/runs/77/job/1';

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

  it('служебный коммит: красный slow цикл один раз перезапускает сам и работает дальше', async () => {
    // 2026-10-14: раньше цикл ждал владельца со словами «перешли ссылку Claude».
    const run = await runWorld({
      sessions: [NEXT_DONE, REVIEW_OK],
      slow: [RED_RUN],
      headTrailer: '06/infra\n',
    });
    expect(run.reruns).toEqual([77]);
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
    expect(run.lines.some((line) => line.includes('Claude'))).toBe(false);
  });

  it('служебный коммит: после перезапуска снова красный — баг через $bug, без владельца', async () => {
    const run = await runWorld({
      sessions: [{ answer: 'баг записан', commit: true }],
      slow: [RED_RUN],
      headTrailer: '06/infra\n',
      state: { slowRerun: 'c0' },
    });
    expect(run.reruns).toEqual([]);
    expect(run.prompts[0]).toMatch(
      /^\$bug красный slow \(все тесты\) на служебном коммите c0, перезапуск прогона не помог: failure job=tests .*runs\/77.*Класс Б1/u,
    );
  });

  it('служебный коммит: прогон без номера не перезапустить — сразу $bug', async () => {
    const run = await runWorld({
      sessions: [{ answer: 'баг записан', commit: true }],
      slow: [RED],
      headTrailer: '06/infra\n',
    });
    expect(run.reruns).toEqual([]);
    expect(run.prompts[0]).toMatch(/^\$bug красный slow/u);
  });

  it('баг уже записан — красный slow на служебном коммите пропускает очередь к его задаче', async () => {
    const run = await runWorld({
      sessions: [NEXT_DONE, REVIEW_OK],
      slow: [RED],
      headTrailer: '06\n',
      state: { slowBug: 'abc' },
    });
    expect(run.prompts).toEqual(['$next', '$review 06/T1j5-Б1']);
  });

  it('красный slow, перезапущенный на GitHub, зеленеет на том же HEAD — цикл продолжает сам', async () => {
    // 2026-10-14: прогон slow упал на SIGSEGV воркера vitest; после «Re-run failed jobs»
    // цикл ждал нового коммита, хотя HEAD тот же и slow уже зелёный.
    const run = await runWorld({
      sessions: [NEXT_DONE, REVIEW_OK],
      slow: [RED, 'success https://slow/3'],
      headTrailer: '06/T1e\n',
      state: { slowFixes: ['06/T1e'], slowBug: 'abc' },
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
      headTrailer: '06/T1e\n',
      state: { slowFixes: ['06/T1e'], slowBug: 'abc' },
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

  it('второй красный slow после исправления той же задачи — после перезапуска $bug', async () => {
    const run = await runWorld({
      sessions: [{ answer: 'баг записан', commit: true }],
      slow: [RED_RUN],
      headTrailer: '06/T1e',
      state: { slowFixes: ['06/T1e'], slowRerun: 'c0' },
    });
    expect(run.prompts[0]).toMatch(/^\$bug красный slow .*после исправления 06\/T1e/u);
  });

  it('не помогли ни исправление, ни перезапуск, ни записанный баг — к владельцу за «$decide»', async () => {
    const run = await runWorld({
      sessions: [],
      slow: [RED],
      headTrailer: '06/T1e',
      state: { slowFixes: ['06/T1e'], slowBug: 'abc' },
    });
    expect(run.prompts).toEqual([]);
    const waiting = run.lines.find((line) => line.startsWith('жду: slow всё ещё красный'));
    expect(waiting).toContain('Issue «$decide»');
    expect(waiting).not.toContain('Claude');
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

  it('красный slow перед закрытием на служебном коммите — перезапуск, $stage-close после зелёного', async () => {
    const run = await runWorld({
      status: lastQueue,
      stage: closeAll(fixtureStage),
      slow: ['pending https://slow/3 10', RED_RUN, RED_RUN, 'success https://slow/4'],
      headTrailer: '06/infra\n',
      sessions: [{ answer: 'Этап 06 закрыт', status: lastQueue.replace('| 06 —', '| 07 —') }],
    });
    expect(run.reruns).toEqual([77]);
    expect(run.prompts).toEqual(['$stage-close']);
  });
});
