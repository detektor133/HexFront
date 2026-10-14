// Полноэкранная консоль цикла: отдельный экран терминала, кадр перерисовывается целиком
// (screen.ts), клавиши — по одной без Enter. Терминал в raw-режиме, поэтому Ctrl+C не доходит до
// сессий codex сигналом: выход останавливает их сам (stopAllCommands).
import { stageSummary, type Board } from './board.ts';
import { readStage } from './context.ts';
import { stopAllCommands } from './process.ts';
import { renderFrame } from './screen.ts';
import { MAX_STREAMS } from './state.ts';

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

const ESC = '\u001b[';
const SCREEN_ON = `${ESC}?1049h${ESC}?25l${ESC}2J`;
const SCREEN_OFF = `${ESC}0m${ESC}?25h${ESC}?1049l`;

export type KeyAction =
  | { readonly kind: 'limit'; readonly value: number }
  | { readonly kind: 'wake' }
  | { readonly kind: 'quit'; readonly force: boolean };

/**
 * Клавиша владельца: число агентов, «проверить сейчас», выход; раскладка — латиница и кириллица.
 * Кусок ввода длиннее одной клавиши — вставка текста, а не команда: иначе две «й» в вставленной
 * строке оборвали бы все сессии codex.
 */
export function parseKey(chunk: string, limit: number): KeyAction | undefined {
  if (chunk.includes('\u0003')) return { kind: 'quit', force: true };
  const key = chunk === '\r\n' ? '\r' : chunk;
  if (Array.from(key).length !== 1) return undefined;
  if (/^[qQйЙ]$/u.test(key)) return { kind: 'quit', force: false };
  if (/^[+=]$/u.test(key)) return { kind: 'limit', value: limit + 1 };
  if (/^[-_−]$/u.test(key)) return { kind: 'limit', value: limit - 1 };
  if (new RegExp(`^[1-${MAX_STREAMS}]$`, 'u').test(key))
    return { kind: 'limit', value: Number(key) };
  if (/^[\r\nrRкК]$/u.test(key)) return { kind: 'wake' };
  return undefined;
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
  readonly close: () => void;
}

/** Отдельный экран терминала с кадром screen.ts: перерисовка по изменениям, часам и размеру окна. */
function openScreen(board: Board, root: string): Screen {
  const out = process.stdout;
  const colors = process.env.NO_COLOR === undefined;
  let closed = false;
  let pending: NodeJS.Timeout | undefined;
  let noticeTimer: NodeJS.Timeout | undefined;
  const draw = (): void => {
    pending = undefined;
    if (closed) return;
    // Последний столбец не занимается: часть терминалов Windows переносит строку на нём.
    const width = Math.max(1, (out.columns || 100) - 1);
    const lines = renderFrame(board, width, out.rows || 30, colors);
    out.write(lines.map((text, index) => `${ESC}${index + 1};1H${text}${ESC}K`).join(''));
  };
  const redraw = (): void => {
    if (!closed && pending === undefined) pending = setTimeout(draw, DRAW_DELAY_MS);
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
export function createConsoleUi(board: Board, root: string): ConsoleUi {
  const input = process.stdin;
  const screen = openScreen(board, root);
  const sleepers = new Set<() => void>();
  let quitArmed = Number.NEGATIVE_INFINITY;
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
  const act = (action: KeyAction): void => {
    if (action.kind === 'quit') {
      if (action.force || board.time - quitArmed < QUIT_CONFIRM_MS) quit();
      quitArmed = board.time;
      screen.say('Нажми Q ещё раз, чтобы выйти: идущие сессии codex прервутся');
      return;
    }
    if (action.kind === 'limit') {
      const limit = board.requestLimit(action.value);
      screen.say(
        board.pendingLimit === undefined
          ? `Агентов и так до ${limit}`
          : `Агентов станет до ${limit}, как только цикл закончит текущий шаг`,
      );
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
