import { describe, expect, it, vi } from 'vitest';

import { Board, MAIN_AGENT } from './board.ts';
import { parseKey, performAction, type ActionDeps } from './console-ui.ts';
import type { GithubClient } from './github.ts';
import { actionKey, issueUrl, waitActions } from './owner-actions.ts';

const REPO = 'detektor133/HexFront';
const SLOW_RED =
  'красный slow (все тесты) на служебном коммите: failure job=tests https://github.com/detektor133/HexFront/actions/runs/38533518333';

describe('действия ожидания', () => {
  it('красный slow: перезапуск прогона по номеру из ссылки и ссылка, без повтора — он снимается сам', () => {
    const actions = waitActions('slow:abc', SLOW_RED, true, REPO);
    expect(actions.map((action) => action.key)).toEqual(['З', 'О']);
    expect(actions[0]).toMatchObject({ kind: 'rerun', runId: 38533518333 });
    expect(actions[1]).toMatchObject({
      kind: 'open',
      target: 'https://github.com/detektor133/HexFront/actions/runs/38533518333',
    });
  });

  it('задача владельца: готовая Issue «$done» с номером задачи, повтор не предлагается', () => {
    const actions = waitActions(
      'owner:06/T1j5-Б1',
      'очередь дошла до 06/T1j5-Б1 — это задача владельца. Когда сделаешь — Issue «$done 06/T1j5-Б1» с текстом',
      false,
      REPO,
    );
    expect(actions).toEqual([
      {
        kind: 'open',
        key: 'И',
        label: 'Issue «$done 06/T1j5-Б1»',
        target: issueUrl(REPO, '$done 06/T1j5-Б1'),
      },
    ]);
    const url = new URL(issueUrl(REPO, '$done 06/T1j5-Б1'));
    expect(url.pathname).toBe('/detektor133/HexFront/issues/new');
    expect(url.searchParams.get('labels')).toBe('agent');
    expect(url.searchParams.get('body')).toBe('$done 06/T1j5-Б1\n');
  });

  it('исчерпанные круги: «дать ещё круги»; прочие ожидания — «повторить»', () => {
    expect(waitActions('rounds:07/T2', '3 ВОЗВРАТ подряд по 07/T2', false)).toEqual([
      { kind: 'retry', key: 'П', label: 'дать ещё круги' },
    ]);
    expect(waitActions('review:07/T2', 'после $review дерево не чистое', false)).toEqual([
      { kind: 'retry', key: 'П', label: 'повторить' },
    ]);
  });

  it('вопрос исполнителя: две готовые Issue — ответ «$decide» и своя работа «$done NN/Tn»', () => {
    const reason =
      '07/T2 не отмечена [~]: нужен владелец — ответ на вопрос Issue «$decide», своя проверка или задача — «$done 07/T2»';
    const actions = waitActions('task:07/T2', reason, false, REPO);
    expect(actions.map((action) => `${action.key} ${action.label}`)).toEqual([
      'П повторить',
      'И Issue «$decide»',
      'Д Issue «$done 07/T2»',
    ]);
    expect(actionKey('l')).toBe('Д');
  });

  it('блокеры plan предлагают ответить в консоли и не предлагают бесполезный повтор', () => {
    const reason =
      'до 07/T17 очередь не дошла: 07/T17axb, 07/T17axc ждут решений владельца в docs/QUESTIONS.md. Ответ — Issue «$decide»';
    const actions = waitActions('plan-blocked', reason, false, REPO);
    expect(actions.map((action) => `${action.key} ${action.label}`)).toEqual([
      'В ответить здесь',
      'И Issue «$decide»',
    ]);
    expect(actions[0]).toMatchObject({
      kind: 'answer',
      tasks: ['07/T17axb', '07/T17axc'],
    });
  });

  it('заготовка «$done NN/Tn», ожидание без GitHub и PR этапа не дают ни Issue, ни повтора', () => {
    const dirty = waitActions(
      'dirty',
      'дерево не чистое. Работа владельца — Issue «$done NN/Tn»',
      true,
      REPO,
    );
    expect(dirty).toEqual([]);
    expect(waitActions('owner:07/T5', 'Issue «$done 07/T5»', false)).toEqual([]);
    const merge = waitActions(
      'merge:stage-07',
      'этап закрыт, PR https://github.com/detektor133/HexFront/pull/15 — нажми Merge',
      false,
      REPO,
    );
    expect(merge.map((action) => action.key)).toEqual(['О']);
  });

  it('ссылка без знаков препинания за ней; slow без ссылки на прогон — без перезапуска', () => {
    const [open] = waitActions('slow:abc', 'красный slow: failure job=tests https://slow/2.', true);
    expect(open).toMatchObject({ kind: 'open', target: 'https://slow/2' });
    expect(
      waitActions('slow:abc', 'красный slow: failure job=tests https://slow/2', true),
    ).toHaveLength(1);
  });

  it('клавиши действий в обеих раскладках; цифры и Q остаются числом агентов и выходом', () => {
    expect(['П', 'п', 'g', 'G'].map(actionKey)).toEqual(['П', 'П', 'П', 'П']);
    expect(['з', 'p', 'о', 'j', 'и', 'b', 'л', 'k'].map(actionKey)).toEqual([
      'З',
      'З',
      'О',
      'О',
      'И',
      'И',
      'Л',
      'Л',
    ]);
    expect(parseKey('g', 1)).toEqual({ kind: 'action', key: 'П' });
    expect(parseKey('2', 1)).toBeUndefined();
    expect(parseKey('q', 1)).toEqual({ kind: 'quit', force: false });
    expect(parseKey('gp', 1)).toBeUndefined();
    expect(parseKey('x', 1)).toBeUndefined();
  });
});

const deps = (
  board: Board,
  github?: Partial<GithubClient>,
  answer: ActionDeps['answer'] = () => Promise.resolve(false),
) => {
  const notices: string[] = [];
  const result = {
    notices,
    opened: [] as string[],
    wakes: [] as number[],
  };
  const value: ActionDeps = {
    board,
    github: github as GithubClient | undefined,
    open: (target) => result.opened.push(target),
    say: (notice) => notices.push(notice),
    answer,
    wake: (delayMs = 0) => result.wakes.push(delayMs),
  };
  return { ...result, value };
};

describe('ответ владельца клавишей', () => {
  it('ответ plan создаётся интерактивом, ожидание повторяется сразу после отправки', async () => {
    const board = new Board(() => 0);
    const actions = waitActions(
      'plan-blocked',
      'до 07/T17 очередь не дошла: 07/T17axb ждут решений владельца в docs/QUESTIONS.md. Ответ — Issue «$decide»',
      false,
      REPO,
    );
    board.wait(MAIN_AGENT, 'вопросы plan', actions);
    const answer = vi.fn(() => Promise.resolve(true));
    const run = deps(board, {}, answer);
    await performAction('В', run.value);
    expect(answer).toHaveBeenCalledWith(['07/T17axb']);
    expect(board.takeRetries()).toEqual([MAIN_AGENT]);
    expect(run.wakes).toEqual([0]);
  });

  it('повтор: просьба циклу, цикл будится сразу; ожидание снимает цикл, когда применит повтор', async () => {
    const board = new Board(() => 0);
    board.wait(MAIN_AGENT, '3 ВОЗВРАТ подряд по 07/T2', [
      { kind: 'retry', key: 'П', label: 'дать ещё круги' },
    ]);
    const run = deps(board);
    await performAction('П', run.value);
    expect(board.takeRetries()).toEqual([MAIN_AGENT]);
    expect(board.focus?.name).toBe(MAIN_AGENT);
    expect(run.wakes).toEqual([0]);
  });

  it('ссылка и лог последней сессии открываются, цикл не будится', async () => {
    const board = new Board(() => 0);
    board.end(MAIN_AGENT, 'ревью', '.ai-logs/agent-loop/1.log', '/repo/.ai-logs/agent-loop/1.log');
    board.wait(MAIN_AGENT, 'красный slow', waitActions('slow:abc', SLOW_RED, true, REPO));
    const run = deps(board);
    await performAction('Л', run.value);
    await performAction('О', run.value);
    expect(run.opened).toEqual([
      '/repo/.ai-logs/agent-loop/1.log',
      'https://github.com/detektor133/HexFront/actions/runs/38533518333',
    ]);
    expect(run.wakes).toEqual([]);
  });

  it('перезапуск прогона: запрос GitHub, повтор шага и проверка цикла через паузу', async () => {
    const board = new Board(() => 0);
    board.wait(MAIN_AGENT, 'красный slow', waitActions('slow:abc', SLOW_RED, true, REPO));
    const rerunFailedJobs = vi.fn(() => Promise.resolve());
    const run = deps(board, { rerunFailedJobs });
    await performAction('З', run.value);
    expect(rerunFailedJobs).toHaveBeenCalledWith(38533518333);
    expect(board.takeRetries()).toEqual([MAIN_AGENT]);
    expect(run.wakes).toHaveLength(1);
    expect(run.wakes[0]).toBeGreaterThan(0);
  });

  it('403 без права у токена: сказано, какое право нужно; ожидание остаётся', async () => {
    const board = new Board(() => 0);
    board.wait(MAIN_AGENT, 'красный slow', waitActions('slow:abc', SLOW_RED, true, REPO));
    const rerunFailedJobs = () =>
      Promise.reject(
        new Error(
          'GitHub POST /actions/runs/1/rerun-failed-jobs: 403 — Resource not accessible by personal access token',
        ),
      );
    const run = deps(board, { rerunFailedJobs });
    await performAction('З', run.value);
    expect(run.notices.at(-1)).toMatch(/Actions: Read and write/u);
    expect(board.takeRetries()).toEqual([]);
    expect(board.focus?.name).toBe(MAIN_AGENT);
    expect(run.wakes).toEqual([]);
  });

  it('403 из-за самого прогона (уже идёт) — текст GitHub, а не совет про права токена', async () => {
    const board = new Board(() => 0);
    board.wait(MAIN_AGENT, 'красный slow', waitActions('slow:abc', SLOW_RED, true, REPO));
    const rerunFailedJobs = () =>
      Promise.reject(new Error('GitHub POST …: 403 — This workflow is already running'));
    const run = deps(board, { rerunFailedJobs });
    await performAction('З', run.value);
    expect(run.notices.at(-1)).toBe(
      'Прогон не перезапущен: GitHub POST …: 403 — This workflow is already running',
    );
  });

  it('второе нажатие «перезапуск», пока GitHub не ответил, второй запрос не шлёт', async () => {
    const board = new Board(() => 0);
    board.wait(MAIN_AGENT, 'красный slow', waitActions('slow:abc', SLOW_RED, true, REPO));
    let answer: () => void = () => undefined;
    const rerunFailedJobs = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    const run = deps(board, { rerunFailedJobs });
    const first = performAction('З', run.value);
    await performAction('З', run.value);
    expect(run.notices.at(-1)).toMatch(/уже запрошен/u);
    answer();
    await first;
    expect(rerunFailedJobs).toHaveBeenCalledTimes(1);
    expect(board.focus).toBeUndefined();
  });

  it('без GITHUB_TOKEN и клавиша, которой нет у ожидания, — объяснение, без действия', async () => {
    const board = new Board(() => 0);
    board.wait(MAIN_AGENT, 'красный slow', waitActions('slow:abc', SLOW_RED, true, REPO));
    const run = deps(board);
    await performAction('З', run.value);
    expect(run.notices.at(-1)).toMatch(/GITHUB_TOKEN/u);
    await performAction('П', run.value);
    expect(run.notices.at(-1)).toMatch(/ничего не делает/u);
    expect(board.takeRetries()).toEqual([]);
  });
});
