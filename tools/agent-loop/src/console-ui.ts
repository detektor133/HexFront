// Консоль цикла: протокол прокручивается сверху, панель агентов закреплена внизу, команды
// владельца — строкой с Enter. Ctrl+C работает как обычно: терминал не в raw-режиме, поэтому
// сигнал получают и сессии codex.
import { createInterface } from 'node:readline';

import { stageSummary, type Board } from './board.ts';
import { readStage } from './context.ts';
import { MAX_STREAMS } from './state.ts';

/** Как часто обновлять минуты на панели и сводку этапа, мс. */
const REFRESH_MS = 15_000;
const PROMPT = `+ / - / 1–${MAX_STREAMS} и Enter — число агентов, Enter — проверить сейчас, Ctrl+C — выход > `;

const ESC = '\u001b[';
const COLORS = { red: 31, green: 32, yellow: 33, cyan: 36, magenta: 35, blue: 34, bold: 1 };
type Color = keyof typeof COLORS;
const STREAM_COLORS: readonly Color[] = ['cyan', 'magenta', 'blue', 'green'];

/** Цвет строки протокола по смыслу: ошибка, ожидание владельца, успех. */
export function lineColor(line: string): Color | undefined {
  if (/(^|\] )(ошибка|сбой)|CI красный|slow красный/u.test(line)) return 'red';
  if (/(^|\] )жду:/u.test(line)) return 'yellow';
  if (/(^|\] )(готово:|влита )|CI зелёный|slow зелёный/u.test(line)) return 'green';
  return undefined;
}

/** Команда владельца в консоли: число агентов или «проверить сейчас». */
export function parseConsoleCommand(
  text: string,
  limit: number,
): { readonly limit?: number; readonly wake: boolean } | undefined {
  const command = text.trim();
  if (command === '') return { wake: true };
  if (/^\+$/u.test(command)) return { limit: limit + 1, wake: true };
  if (/^[-−]$/u.test(command)) return { limit: limit - 1, wake: true };
  if (/^\d+$/u.test(command)) return { limit: Number(command), wake: true };
  return undefined;
}

export interface ConsoleUi {
  readonly writeLine: (line: string) => void;
  readonly sleep: (ms: number) => Promise<'timer' | 'wake'>;
  readonly close: () => void;
}

/** Консоль с панелью; только для терминала — без него cli печатает прежние строки. */
export function createConsoleUi(board: Board, root: string): ConsoleUi {
  const out = process.stdout;
  const colors = process.env.NO_COLOR === undefined;
  const paint = (color: Color | undefined, text: string): string =>
    colors && color !== undefined ? `${ESC}${COLORS[color]}m${text}${ESC}0m` : text;
  const sleepers = new Set<(result: 'wake') => void>();
  let drawn = 0;
  // Enter владельца сдвигает курсор на строку ниже панели: стирать на строку больше.
  let typed = false;

  const clear = (): void => {
    if (drawn === 0) return;
    const up = drawn - 1 + (typed ? 1 : 0);
    out.write(`\r${up > 0 ? `${ESC}${up}A` : ''}${ESC}J`);
    drawn = 0;
    typed = false;
  };
  const draw = (): void => {
    const width = Math.max(40, (out.columns || 100) - 1);
    const cut = (text: string): string =>
      text.length > width ? `${text.slice(0, width - 1)}…` : text;
    const [header = '', ...rest] = board.render();
    const lines = [paint('bold', cut(header)), ...rest.map(cut)];
    out.write(`${lines.join('\n')}\n${paint('bold', cut(PROMPT))}`);
    drawn = lines.length + 1;
    typed = false;
  };
  let closed = false;
  const redraw = (): void => {
    if (closed) return;
    clear();
    draw();
  };
  const stamp = (): string => new Date().toLocaleTimeString('ru-RU');
  const writeLine = (line: string): void => {
    const stream = /^\[w(\d)/u.exec(line)?.[1];
    const color =
      lineColor(line) ??
      (stream === undefined
        ? undefined
        : STREAM_COLORS[(Number(stream) - 1) % STREAM_COLORS.length]);
    clear();
    out.write(`${paint(color, `[${stamp()}] ${line}`)}\n`);
    if (!closed) draw();
  };

  const refreshStage = async (): Promise<void> => {
    try {
      const { status, stageText } = await readStage(root);
      board.stage = stageSummary(status, stageText);
    } catch {
      // STATUS не читается: цикл сам ждёт с причиной в протоколе, панель — без строки этапа.
      board.stage = undefined;
    }
    redraw();
  };
  board.onChange = redraw;
  const timer = setInterval(() => void refreshStage(), REFRESH_MS);
  timer.unref();
  void refreshStage();

  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', (text) => {
    typed = true;
    const command = parseConsoleCommand(text, board.shownLimit);
    if (command === undefined) {
      writeLine(`консоль: не понял «${text.trim()}» — ${PROMPT.replace(/ > $/u, '')}`);
      return;
    }
    if (command.limit !== undefined) {
      const limit = board.requestLimit(command.limit);
      writeLine(`консоль: агентов до ${limit} — применится, как только цикл закончит текущий шаг`);
    } else redraw();
    for (const wake of sleepers) wake('wake');
    sleepers.clear();
  });

  const sleep = (ms: number): Promise<'timer' | 'wake'> =>
    new Promise((resolve) => {
      const wake = (result: 'wake'): void => {
        clearTimeout(pause);
        resolve(result);
      };
      const pause = setTimeout(() => {
        sleepers.delete(wake);
        resolve('timer');
      }, ms);
      sleepers.add(wake);
    });

  return {
    writeLine,
    sleep,
    close: () => {
      closed = true;
      clearInterval(timer);
      input.close();
      clear();
    },
  };
}
