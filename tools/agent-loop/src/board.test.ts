import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Board, MAIN_AGENT, stageSummary } from './board.ts';
import { endPause, type LoopContext } from './context.ts';
import { fixtureStage, fixtureStatus, runWorld } from './test-world.ts';

const clock = (start = 0) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

describe('модель экрана', () => {
  it('агенты по порядку: главный, затем потоки по номеру', () => {
    const board = new Board(clock().now);
    board.begin('w2', '$task 07/T4');
    board.begin('w1', '$task 07/T3');
    board.begin(MAIN_AGENT, 'CI 07/T1');
    expect(board.agents().map((agent) => agent.name)).toEqual([MAIN_AGENT, 'w1', 'w2']);
    expect(board.working).toBe(3);
  });

  it('смена задачи агента не сбрасывает время текущего дела', () => {
    const time = clock();
    const board = new Board(time.now);
    board.begin('w1', '$task 07/T1');
    time.advance(7 * 60_000);
    board.task('w1', '07/T2');
    expect(board.agents()[0]).toMatchObject({ task: '07/T2', since: 0, phase: 'work' });
  });

  it('ожидание владельца, пауза и свободный агент не считаются работающими', () => {
    const board = new Board(clock().now);
    board.wait('w1', 'вопрос владельцу по 07/T3');
    board.pause('w2', 'лимит codex');
    board.end(MAIN_AGENT, 'нет работы');
    expect(board.working).toBe(0);
    expect(board.agents().map((agent) => agent.phase)).toEqual(['idle', 'wait', 'pause']);
  });

  it('многострочная причина ожидания — одна строка', () => {
    const board = new Board(clock().now);
    board.wait('w1', 'push не прошёл: error: failed\nhint: Updates were rejected');
    expect(board.agents()[0]?.text).toBe('push не прошёл: error: failed');
  });

  it('лог сессии остаётся у агента до следующей сессии', () => {
    const board = new Board(clock().now);
    board.end('w1', '$task 07/T1: готово', '.ai-logs/agent-loop/1.log');
    board.begin('w1', 'CI 07/T1');
    expect(board.agents()[0]?.log).toBe('.ai-logs/agent-loop/1.log');
  });

  it('лог последней сессии — самый свежий среди всех агентов', () => {
    const board = new Board(clock().now);
    board.end(MAIN_AGENT, 'готово', 'main.log');
    board.end('w2', 'готово', 'w2.log');
    expect(board.lastLog).toEqual({ agent: 'w2', path: 'w2.log' });
  });

  it('конец паузы после сбоя убирает паузу с экрана и из памяти цикла', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hexfront-pause-'));
    try {
      const board = new Board(clock().now);
      board.pause(MAIN_AGENT, 'лимит codex — повтор через 30 мин');
      const state = { retryAfter: 5 };
      // Конец паузы читает только корень, экран и память цикла.
      await endPause({ config: { root, board }, state } as unknown as LoopContext);
      expect(state).toEqual({});
      expect(board.agents()[0]).toMatchObject({
        phase: 'idle',
        text: 'пауза кончилась — повторяю',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('поток, отпустивший задачу, исчезает', () => {
    const board = new Board(clock().now);
    board.begin('w1', '$task 07/T2');
    board.remove('w1');
    expect(board.agents()).toHaveLength(0);
  });

  it('журнал хранит последние 500 строк и отдаёт хвост старыми первыми', () => {
    const board = new Board(clock().now);
    for (let index = 0; index < 600; index += 1) board.log(`строка ${index}`);
    expect(board.tail(2).map((line) => line.text)).toEqual(['строка 598', 'строка 599']);
    expect(board.tail(1000)).toHaveLength(500);
    expect(board.tail(0)).toEqual([]);
  });

  it('последовательный режим фиксирует одного агента', () => {
    const board = new Board(clock().now);
    expect(board.requestLimit(9)).toBe(1);
    expect(board.pendingLimit).toBeUndefined();
    expect(board.shownLimit).toBe(1);
    expect(board.takeLimit()).toBeUndefined();
    expect(board.requestLimit(0)).toBe(1);
  });

  it('старый запрос потоков не меняет предел', () => {
    const board = new Board(clock().now);
    board.requestLimit(3);
    expect(board.pendingLimit).toBeUndefined();
    expect(board.takeLimit()).toBeUndefined();
  });

  it('сводка этапа: готово, на ревью и ближайшие незакрытые задачи очереди', () => {
    const summary = stageSummary(fixtureStatus, fixtureStage);
    expect(summary.stage).toBe('06');
    expect(summary.branch).toBe('stage-06');
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.done + summary.review + summary.next.length).toBeLessThanOrEqual(summary.total);
    expect(summary.next.length).toBeLessThanOrEqual(5);
  });
});

describe('модель экрана в цикле', () => {
  it('сессии, CI и готовые задачи попадают в счётчики, свободный главный агент не работает', async () => {
    const board = new Board(Date.now);
    await runWorld({
      board,
      sessions: [
        { answer: 'Готово', commit: true, push: false },
        { answer: 'OK', push: false },
      ],
    });
    expect(board.totals).toMatchObject({ done: 1, returns: 0, sessions: 2, ciGreen: 2, ciRed: 0 });
    expect(board.agents()[0]).toMatchObject({ name: MAIN_AGENT });
    expect(board.agents()[0]?.phase).not.toBe('work');
  });

  it('ВОЗВРАТ ревью считается', async () => {
    const board = new Board(Date.now);
    await runWorld({
      board,
      sessions: [
        { answer: 'Готово', commit: true, push: false },
        { answer: 'ВОЗВРАТ\n- КОД: нет теста, packages/sim/src/task.ts:1', push: false },
        { answer: 'Исправлено', commit: true, push: false },
        { answer: 'OK', push: false },
        { answer: 'OK', push: false },
      ],
    });
    expect(board.totals.returns).toBe(1);
    expect(board.totals.done).toBe(1);
  });
});
