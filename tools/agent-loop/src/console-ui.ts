// Полноэкранная консоль цикла: отдельный экран терминала, кадр перерисовывается целиком
// (screen.ts), клавиши — по одной без Enter. Терминал в raw-режиме, поэтому Ctrl+C не доходит до
// сессий codex сигналом: выход останавливает их сам (stopAllCommands).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { stageSummary, type Board } from './board.ts';
import { readStage } from './context.ts';
import type { GithubClient } from './github.ts';
import { actionKey, openExternal, type ActionKey } from './owner-actions.ts';
import { acceptProposal, customDecision, parsePlanQuestions } from './owner-questions.ts';
import { stopAllCommands } from './process.ts';
import { renderFrame } from './screen.ts';

/** Как часто перечитывать STATUS и файл этапа для раздела этапа, мс. */
const STAGE_REFRESH_MS = 15_000;
/** Часы и минуты на экране. */
const CLOCK_MS = 1000;
/** Изменения модели чаще этого сливаются в одну перерисовку. */
const DRAW_DELAY_MS = 50;
/** Окно второго нажатия Q: случайное нажатие не обрывает сессию codex. */
const QUIT_CONFIRM_MS = 5000;
/** Сколько видно ответ консоли на клавишу: дальше строка снова показывает лог сессии. */
const NOTICE_MS = 8000;
/** Строк журнала, оставляемых в обычном экране терминала после выхода. */
const TAIL_AFTER_EXIT = 15;
/**
 * Через сколько после перезапуска прогона цикл проверяет его снова: сразу после запроса GitHub
 * ещё может отдавать прежний красный итог.
 */
const RERUN_SETTLE_MS = 20_000;

const ESC = '\u001b[';
const SCREEN_ON = `${ESC}?1049h${ESC}?25l${ESC}2J`;
const SCREEN_OFF = `${ESC}0m${ESC}?25h${ESC}?1049l`;

export type KeyAction =
  | { readonly kind: 'wake' }
  | { readonly kind: 'action'; readonly key: ActionKey }
  | { readonly kind: 'quit'; readonly force: boolean };

/**
 * Клавиша владельца: число агентов, «проверить сейчас», ответ на ожидание, выход; раскладка —
 * латиница и кириллица.
 * Кусок ввода длиннее одной клавиши — вставка текста, а не команда: иначе две «й» в вставленной
 * строке оборвали бы все сессии codex.
 */
export function parseKey(chunk: string, _limit: number): KeyAction | undefined {
  if (chunk.includes('\u0003')) return { kind: 'quit', force: true };
  const key = chunk === '\r\n' ? '\r' : chunk;
  if (Array.from(key).length !== 1) return undefined;
  if (/^[qQйЙ]$/u.test(key)) return { kind: 'quit', force: false };
  if (/^[\r\nrRкК]$/u.test(key)) return { kind: 'wake' };
  const action = actionKey(key);
  return action === undefined ? undefined : { kind: 'action', key: action };
}

export interface ActionDeps {
  readonly board: Board;
  readonly github: GithubClient | undefined;
  readonly open: (target: string, onError: (message: string) => void) => void;
  readonly say: (notice: string) => void;
  /** Показать вопросы plan построчно и создать `$decide` из ответов. */
  readonly answer: (tasks: readonly string[]) => Promise<boolean>;
  /** Разбудить цикл: сейчас или через delayMs. */
  readonly wake: (delayMs?: number) => void;
}

/** Ответ владельца на ожидание в баннере клавишей key. */
/** Запрос перезапуска уже идёт: второе нажатие не шлёт второй POST, GitHub ответил бы 403. */
let rerunning = false;
/** Ответы GitHub, когда у токена нет права на Actions; прочие 403 — состояние самого прогона. */
const NO_PERMISSION_RE = /Resource not accessible|Must have admin rights|нет нужного права/u;

export async function performAction(key: ActionKey, deps: ActionDeps): Promise<void> {
  const { board, say } = deps;
  const agent = board.focus?.name;
  const action = board.focusActions.find((candidate) => candidate.key === key);
  if (agent === undefined || action === undefined) {
    say(`Клавиша ${key} сейчас ничего не делает: она для ожидания, где показана`);
    return;
  }
  if (action.kind === 'retry') {
    board.requestRetry(agent);
    say(`Повторяю шаг ${agent}`);
    deps.wake();
    return;
  }
  if (action.kind === 'open') {
    deps.open(action.target, say);
    say(`Открываю: ${action.label}`);
    return;
  }
  if (action.kind === 'answer') {
    if (deps.github === undefined) {
      say('Без GITHUB_TOKEN консоль не сможет создать Issue с ответами');
      return;
    }
    if (await deps.answer(action.tasks)) {
      board.requestRetry(agent);
      say('Ответы отправлены — цикл применит `$decide`');
      deps.wake();
    }
    return;
  }
  if (deps.github === undefined) {
    say(
      'Без GITHUB_TOKEN цикл не перезапустит прогон: открой ссылку (О) и нажми «Re-run failed jobs»',
    );
    return;
  }
  if (rerunning) {
    say('Перезапуск прогона уже запрошен — жду ответа GitHub');
    return;
  }
  rerunning = true;
  say('Перезапускаю прогон на GitHub…');
  try {
    await deps.github.rerunFailedJobs(action.runId);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    say(
      NO_PERMISSION_RE.test(text)
        ? 'GitHub не дал перезапустить: GITHUB_TOKEN нужно право «Actions: Read and write». Пока открой ссылку (О) и нажми «Re-run failed jobs»'
        : `Прогон не перезапущен: ${text}`,
    );
    return;
  } finally {
    rerunning = false;
  }
  // Баннер больше не зовёт владельца: прогон идёт, итог цикл проверит сам.
  board.end(agent, 'прогон перезапущен на GitHub — жду итога');
  board.requestRetry(agent);
  say('Прогон перезапущен — цикл работает дальше, пока он идёт; красный снова — спросит');
  deps.wake(RERUN_SETTLE_MS);
}

export interface ConsoleUi {
  readonly writeLine: (line: string) => void;
  readonly sleep: (ms: number) => Promise<'timer' | 'wake'>;
  readonly close: () => void;
}

const stamp = (ms: number): string => new Date(ms).toLocaleTimeString('ru-RU');

interface Screen {
  readonly redraw: () => void;
  /** Сообщение владельцу в нижней строке; само гаснет через NOTICE_MS. */
  readonly say: (notice: string) => void;
  readonly closed: () => boolean;
  readonly suspend: () => void;
  readonly resume: () => void;
  readonly close: () => void;
}

/** Отдельный экран терминала с кадром screen.ts: перерисовка по изменениям, часам и размеру окна. */
function openScreen(board: Board, root: string): Screen {
  const out = process.stdout;
  const colors = process.env.NO_COLOR === undefined;
  let closed = false;
  let suspended = false;
  let pending: NodeJS.Timeout | undefined;
  let noticeTimer: NodeJS.Timeout | undefined;
  const draw = (): void => {
    pending = undefined;
    if (closed || suspended) return;
    // Последний столбец не занимается: часть терминалов Windows переносит строку на нём.
    const width = Math.max(1, (out.columns || 100) - 1);
    const lines = renderFrame(board, width, out.rows || 30, colors);
    out.write(lines.map((text, index) => `${ESC}${index + 1};1H${text}${ESC}K`).join(''));
  };
  const redraw = (): void => {
    if (!closed && !suspended && pending === undefined) pending = setTimeout(draw, DRAW_DELAY_MS);
  };
  const say = (notice: string): void => {
    if (closed) return;
    board.notice = notice;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      if (board.notice === notice) board.notice = '';
      redraw();
    }, NOTICE_MS);
    redraw();
  };
  const refreshStage = async (): Promise<void> => {
    try {
      const { status, stageText } = await readStage(root);
      board.stage = stageSummary(status, stageText);
    } catch (error) {
      // STATUS не читается: цикл сам ждёт с причиной в журнале, экран — без раздела этапа.
      board.stage = undefined;
      say(`STATUS не прочитан: ${error instanceof Error ? error.message : String(error)}`);
    }
    redraw();
  };
  const onResize = (): void => {
    out.write(`${ESC}2J`);
    draw();
  };
  out.write(SCREEN_ON);
  // Выход по ошибке или process.exit не должен оставить терминал без курсора в чужом экране.
  process.once('exit', () => {
    if (!closed) out.write(SCREEN_OFF);
  });
  out.on('resize', onResize);
  board.onChange = redraw;
  const stageTimer = setInterval(() => void refreshStage(), STAGE_REFRESH_MS);
  const clockTimer = setInterval(redraw, CLOCK_MS);
  void refreshStage();
  return {
    redraw,
    say,
    closed: () => closed,
    suspend: () => {
      if (closed || suspended) return;
      suspended = true;
      clearTimeout(pending);
      pending = undefined;
      out.write(SCREEN_OFF);
    },
    resume: () => {
      if (closed || !suspended) return;
      suspended = false;
      out.write(SCREEN_ON);
      draw();
    },
    close: () => {
      if (closed) return;
      closed = true;
      for (const timer of [stageTimer, clockTimer]) clearInterval(timer);
      clearTimeout(pending);
      clearTimeout(noticeTimer);
      out.off('resize', onResize);
      out.write(SCREEN_OFF);
      // Обычный экран терминала получает хвост журнала: видно, на чём цикл остановился.
      for (const entry of board.tail(TAIL_AFTER_EXIT))
        out.write(`[${stamp(entry.at)}] ${entry.text}\n`);
    },
  };
}

/** Консоль на весь экран; только для терминала — без него cli печатает прежние строки. */
export function createConsoleUi(
  board: Board,
  root: string,
  github: GithubClient | undefined,
): ConsoleUi {
  const input = process.stdin;
  const screen = openScreen(board, root);
  const sleepers = new Set<() => void>();
  let quitArmed = Number.NEGATIVE_INFINITY;
  let answering = false;
  const wakeAll = (): void => {
    for (const wake of sleepers) wake();
    sleepers.clear();
  };
  const close = (): void => {
    input.off('data', onKey);
    if (input.isTTY) input.setRawMode(false);
    input.pause();
    screen.close();
  };
  const quit = (): void => {
    stopAllCommands();
    close();
    process.stdout.write(
      'Цикл остановлен, сессии codex прерваны. Начатая задача доделается при следующем запуске pnpm agent:run.\n',
    );
    process.exit(130);
  };
  const answer = async (tasks: readonly string[]): Promise<boolean> => {
    if (answering || github === undefined) return false;
    answering = true;
    input.off('data', onKey);
    if (input.isTTY) input.setRawMode(false);
    screen.suspend();
    const lines = createInterface({ input, output: process.stdout });
    try {
      const questions = parsePlanQuestions(
        await readFile(join(root, 'docs', 'QUESTIONS.md'), 'utf8'),
        tasks,
      );
      const decisions: string[] = [];
      if (questions.length === 0)
        throw new Error(`В QUESTIONS.md нет вопросов для ${tasks.join(', ')}`);
      process.stdout.write('\nОтветы на вопросы plan\n');
      for (const question of questions) {
        process.stdout.write(`\n${question.task}: ${question.question}\n`);
        process.stdout.write(`  [1] Принять рекомендацию: ${question.proposal}\n`);
        process.stdout.write('  [2] Ввести свой ответ\n  [3] Пропустить этот вопрос\n');
        let choice = '';
        while (!/^[123]$/u.test(choice)) choice = (await lines.question('Выбор [1/2/3]: ')).trim();
        if (choice === '1') decisions.push(acceptProposal(question));
        if (choice === '2') {
          let custom = '';
          while (custom.trim() === '') custom = await lines.question('Твой ответ: ');
          decisions.push(customDecision(question, custom));
        }
      }
      if (decisions.length === 0) return false;
      const confirmed = (await lines.question('\nEnter — отправить `$decide`, N — отменить: '))
        .trim()
        .toLowerCase();
      if (confirmed === 'n' || confirmed === 'н') return false;
      const url = await github.createIssue(
        `$decide: ответы plan ${questions.map((question) => question.task).join(', ')}`,
        `$decide\n\n${decisions.join('\n\n')}`,
      );
      process.stdout.write(`Создана Issue: ${url}\n`);
      return true;
    } finally {
      lines.close();
      answering = false;
      if (input.isTTY) input.setRawMode(true);
      input.on('data', onKey);
      screen.resume();
    }
  };
  const act = (action: KeyAction): void => {
    if (action.kind === 'quit') {
      if (action.force || board.time - quitArmed < QUIT_CONFIRM_MS) quit();
      quitArmed = board.time;
      screen.say('Нажми Q ещё раз, чтобы выйти: идущие сессии codex прервутся');
      return;
    }
    if (action.kind === 'action') {
      performAction(action.key, {
        board,
        github,
        open: openExternal,
        say: screen.say,
        answer,
        wake: (delayMs = 0) => {
          if (delayMs === 0) wakeAll();
          else setTimeout(wakeAll, delayMs).unref();
        },
      }).catch((error: unknown) => {
        // Ошибка ответа на клавишу не должна ронять цикл необработанным отказом промиса.
        screen.say(
          `Клавиша не сработала: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return;
    } else screen.say('Проверяю Issues и main сейчас');
    wakeAll();
  };
  const onKey = (chunk: string): void => {
    const action = parseKey(chunk, board.shownLimit);
    if (action !== undefined) act(action);
  };
  process.on('SIGINT', quit);
  if (input.isTTY) input.setRawMode(true);
  input.setEncoding('utf8');
  input.on('data', onKey);
  input.resume();

  const sleep = (ms: number): Promise<'timer' | 'wake'> =>
    new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        resolve('wake');
      };
      const timer = setTimeout(() => {
        sleepers.delete(wake);
        resolve('timer');
      }, ms);
      sleepers.add(wake);
    });

  return {
    writeLine: (line) => {
      if (screen.closed()) process.stdout.write(`[${stamp(Date.now())}] ${line}\n`);
      else board.log(line);
    },
    sleep,
    close,
  };
}
