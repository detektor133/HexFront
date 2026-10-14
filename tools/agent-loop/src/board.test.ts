import { describe, expect, it } from 'vitest';

import { Board, MAIN_AGENT, stageSummary } from './board.ts';
import { lineColor, parseConsoleCommand } from './console-ui.ts';
import { fixtureStage, fixtureStatus, runWorld } from './test-world.ts';

const clock = (start = 0) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe('панель агентов', () => {
  it('показывает каждого агента с задачей, состоянием и временем, главный — первым', () => {
    const time = clock();
    const board = new Board(time.now);
    board.limit = () => 2;
    board.task('w2', '07/T4');
    board.begin('w2', '$task 07/T4');
    board.task(MAIN_AGENT, '07/T1');
    board.begin(MAIN_AGENT, 'CI 07/T1');
    time.advance(5 * 60_000);
    const [header, first, second] = board.render();
    expect(header).toContain('работают 2 · предел 2');
    expect(first).toMatch(/^главный\s+работает\s+07\/T1\s+CI 07\/T1 · 5 мин$/u);
    expect(second).toMatch(/^w2\s+работает\s+07\/T4\s+\$task 07\/T4 · 5 мин$/u);
  });

  it('смена задачи агента не сбрасывает время текущего дела', () => {
    const time = clock();
    const board = new Board(time.now);
    board.begin('w1', '$task 07/T1');
    time.advance(7 * 60_000);
    board.task('w1', '07/T2');
    expect(board.render()[1]).toMatch(/07\/T2\s+\$task 07\/T1 · 7 мин$/u);
  });

  it('ожидание владельца и свободный агент не считаются работающими', () => {
    const board = new Board(clock().now);
    board.wait('w1', 'вопрос владельцу по 07/T3');
    board.end(MAIN_AGENT, 'нет работы — жду Issues и main');
    expect(board.working).toBe(0);
    expect(board.render().join('\n')).toContain('w1       ждёт');
  });

  it('многострочная причина ожидания занимает одну строку панели', () => {
    const board = new Board(clock().now);
    board.wait('w1', 'push не прошёл: error: failed\nhint: Updates were rejected');
    expect(board.render()).toHaveLength(4);
    expect(board.render()[1]).toContain('push не прошёл: error: failed');
  });

  it('поток, отпустивший задачу, исчезает с панели', () => {
    const board = new Board(clock().now);
    board.begin('w1', '$task 07/T2');
    board.remove('w1');
    expect(board.render()[1]).toBe('(агенты ещё не начали)');
  });

  it('число агентов с клавиатуры — от 1 до 4, видно до применения и читается циклом один раз', () => {
    const board = new Board(clock().now);
    expect(board.requestLimit(9)).toBe(4);
    expect(board.render()[0]).toContain('предел 4 после шага');
    expect(board.takeLimit()).toBe(4);
    expect(board.takeLimit()).toBeUndefined();
    expect(board.requestLimit(0)).toBe(1);
  });

  it('сводка этапа: готово, на ревью и ближайшие незакрытые задачи очереди', () => {
    const summary = stageSummary(fixtureStatus, fixtureStage);
    expect(summary.stage).toBe('06');
    expect(summary.branch).toBe('stage-06');
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.done + summary.review + summary.next.length).toBeLessThanOrEqual(summary.total);
    expect(summary.next.length).toBeLessThanOrEqual(4);
  });
});

describe('команды и цвета консоли', () => {
  it('Enter — проверить сейчас, +/- и число — предел агентов, остальное не команда', () => {
    expect(parseConsoleCommand('', 2)).toEqual({ wake: true });
    expect(parseConsoleCommand(' + ', 2)).toEqual({ limit: 3, wake: true });
    expect(parseConsoleCommand('-', 2)).toEqual({ limit: 1, wake: true });
    expect(parseConsoleCommand('−', 2)).toEqual({ limit: 1, wake: true });
    expect(parseConsoleCommand('3', 1)).toEqual({ limit: 3, wake: true });
    expect(parseConsoleCommand('стоп', 1)).toBeUndefined();
    expect(parseConsoleCommand('2.5', 1)).toBeUndefined();
  });

  it('ошибки красные, ожидание владельца жёлтое, готовое зелёное — и в строках потоков', () => {
    expect(lineColor('ошибка: нет STATUS')).toBe('red');
    expect(lineColor('[w1 07/T2] CI красный за 1 мин: failure')).toBe('red');
    expect(lineColor('[w2 07/T3] жду: вопрос')).toBe('yellow');
    expect(lineColor('готово: 07/T1')).toBe('green');
    expect(lineColor('→ $next (новая сессия codex)')).toBeUndefined();
    // «жду CI» — работа, а не ожидание владельца.
    expect(lineColor('… жду CI перед $review 07/T2')).toBeUndefined();
  });
});

describe('панель в цикле', () => {
  it('сессии, CI и готовые задачи попадают в счётчики, свободный главный агент ждёт Issues', async () => {
    const board = new Board(Date.now);
    await runWorld({
      board,
      sessions: [
        { task: 'T1j5-Б1', mark: '~', answer: 'Готово' },
        { task: 'T1j5-Б1', mark: 'x', answer: 'OK' },
      ],
    });
    expect(board.totals).toMatchObject({ done: 1, returns: 0, sessions: 2, ciGreen: 1, ciRed: 0 });
    expect(board.render().join('\n')).toMatch(/главный\s+(свободен|ждёт)/u);
  });

  it('ВОЗВРАТ ревью считается', async () => {
    const board = new Board(Date.now);
    await runWorld({
      board,
      sessions: [
        { task: 'T1j5-Б1', mark: '~', answer: 'Готово' },
        { task: 'T1j5-Б1', mark: ' ', answer: 'ВОЗВРАТ\n- нет теста' },
        { task: 'T1j5-Б1', mark: '~', answer: 'Готово' },
        { task: 'T1j5-Б1', mark: 'x', answer: 'OK' },
      ],
    });
    expect(board.totals.returns).toBe(1);
    expect(board.totals.done).toBe(1);
  });
});
