// Полноэкранный кадр консоли цикла: рамка, агенты, этап, счётчики, журнал и клавиши. Чистая
// функция от модели Board и размера окна — терминал и клавиши в console-ui.ts.
import { MAIN_AGENT, type AgentView, type Board, type LogLine } from './board.ts';
import { chars, clean, clockText, duration, fit, wrap } from './screen-text.ts';

const STYLES = {
  bold: '1',
  dim: '2',
  red: '31',
  green: '32',
  yellow: '33;1',
  blue: '34',
  magenta: '35',
  cyan: '36',
  gray: '90',
} as const;
export type Style = keyof typeof STYLES;
type Span = readonly [text: string, style?: Style | undefined];
type Paint = (text: string, style?: Style | undefined) => string;

const STREAM_STYLES: readonly Style[] = ['cyan', 'magenta', 'blue', 'green'];
/** Меньше этого окна рамка не помещается: вместо кадра — просьба увеличить окно. */
export const MIN_WIDTH = 60;
export const MIN_HEIGHT = 16;
/** Строк журнала, меньше которых разделы этапа и счётчиков уступают ему место. */
const MIN_JOURNAL = 3;

const PHASES: Readonly<Record<AgentView['phase'], Span>> = {
  work: ['● работает', 'green'],
  wait: ['◆ ждёт тебя', 'yellow'],
  pause: ['‖ пауза', 'magenta'],
  idle: ['○ свободен', 'dim'],
};

/** Цвет строки журнала по смыслу: ошибка, ожидание владельца, успех. */
export function lineColor(line: string): 'red' | 'yellow' | 'green' | undefined {
  if (/(^|\] )(ошибка|сбой)|CI красный|slow красный/u.test(line)) return 'red';
  if (/(^|\] )жду:/u.test(line)) return 'yellow';
  if (/(^|\] )(готово:|влита )|CI зелёный|slow зелёный/u.test(line)) return 'green';
  return undefined;
}

/** Что делает агент — словами, а не командой скилла. */
export function describeWork(text: string): string {
  if (/^\$task \S+ продолжить/u.test(text)) return 'доделывает прерванную работу';
  if (/^\$task \S+ CI красный/u.test(text)) return 'чинит красный CI';
  if (/^\$task \S+ слияние/u.test(text)) return 'разрешает конфликт слияния';
  if (/^\$(task|next)\b/u.test(text)) return 'пишет код';
  if (/^\$review\b/u.test(text)) return 'ревью задачи';
  if (/^\$spec\b/u.test(text)) return 'пишет приёмочные тесты';
  if (/^\$stage-close\b/u.test(text)) return 'закрывает этап';
  if (/^CI /u.test(text)) return 'ждёт CI на GitHub';
  if (/^slow /u.test(text)) return 'ждёт полные тесты (slow)';
  const skill = /^(\$\S+)/u.exec(text)?.[1];
  return skill === undefined ? text : `выполняет ${skill}`;
}

/** Куски, очищенные, обрезанные и дополненные пробелами ровно до width клеток. */
function clip(parts: readonly Span[], width: number): Span[] {
  let left = width;
  const out: Span[] = [];
  for (const [raw, style] of parts) {
    if (left <= 0) break;
    const text = clean(raw);
    const size = chars(text).length;
    out.push([size > left ? fit(text, left) : text, style]);
    left -= Math.min(size, left);
  }
  if (left > 0) out.push([' '.repeat(left)]);
  return out;
}

const spanWidth = (parts: readonly Span[]): number =>
  parts.reduce((sum, [text]) => sum + chars(clean(text)).length, 0);

/** Строка из кусков разного цвета ровно в width клеток. */
const spans = (parts: readonly Span[], width: number, paint: Paint): string =>
  clip(parts, width)
    .map(([text, style]) => paint(text, style))
    .join('');

interface Frame {
  readonly width: number;
  readonly inner: number;
  readonly paint: Paint;
}

const line = (frame: Frame, parts: readonly Span[]): string =>
  `${frame.paint('│', 'gray')} ${spans(parts, frame.inner, frame.paint)} ${frame.paint('│', 'gray')}`;

/** Горизонталь рамки с заголовком слева и, по желанию, текстом справа; ровно width клеток. */
function rule(
  frame: Frame,
  [left, right]: readonly [string, string],
  title: readonly Span[],
  aside: readonly Span[] = [],
): string {
  const head: Span[] = title.length === 0 ? [] : [['─ ', 'gray'], ...title, [' ']];
  const tail: Span[] = aside.length === 0 ? [] : [[' '], ...aside, [' ─', 'gray']];
  const fill = frame.width - 2 - spanWidth(head) - spanWidth(tail);
  // Узкое окно: правый текст уступает место заголовку.
  if (fill < 1 && aside.length > 0) return rule(frame, [left, right], title);
  const body: Span[] = [[left, 'gray'], ...head, ['─'.repeat(Math.max(0, fill)), 'gray'], ...tail];
  return `${spans(body, frame.width - 1, frame.paint)}${frame.paint(right, 'gray')}`;
}

/** Строк причины ожидания в баннере: длинная причина (ссылка, что нажать) не обрезается. */
const REASON_LINES = 4;

/**
 * Главное сверху: нужен ли владелец, пауза или всё идёт само. Ожидание — с причиной целиком
 * и клавишами ответа на него.
 */
function banner(
  frame: Frame,
  board: Board,
  agents: readonly AgentView[],
  reasonLines: number,
): string[] {
  const waiting = agents.filter((agent) => agent.phase === 'wait');
  const first = board.focus;
  if (first !== undefined) {
    const more = waiting.length > 1 ? ` (и ещё ${waiting.length - 1})` : '';
    const lead: Span[] = [
      ['◆ Нужен ты: ', 'yellow'],
      [`${first.name}${more} — `, 'bold'],
    ];
    const indent = '  ';
    const reason = wrap(
      first.text,
      frame.inner - spanWidth(lead),
      frame.inner - indent.length,
      reasonLines,
    );
    const actions = board.focusActions.flatMap((action): Span[] => [
      [`${indent.slice(1)}[${action.key}]`, 'bold'],
      [` ${action.label} `],
    ]);
    return [
      line(frame, [...lead, [reason[0] ?? '', 'yellow']]),
      ...reason.slice(1).map((text) => line(frame, [[indent], [text, 'yellow']])),
      ...(actions.length === 0 ? [] : [line(frame, [[' '], ...actions])]),
    ];
  }
  const paused = agents.find((agent) => agent.phase === 'pause');
  if (paused !== undefined)
    return [
      line(frame, [
        ['‖ Пауза после сбоя, снимется сама: ', 'magenta'],
        [paused.text, 'magenta'],
      ]),
    ];
  if (board.working > 0)
    return [line(frame, [['✓ Всё идёт само — от тебя ничего не нужно', 'green']])];
  return [line(frame, [['○ Работы сейчас нет — жду новые Issues и изменения в main', 'dim']])];
}

/** Ширины столбцов таблицы агентов; «что делает» забирает остаток. */
const COLUMNS = { name: 8, task: 10, phase: 12, time: 11 } as const;

/** Строка таблицы; пустое место потока — без времени: агента там ещё нет. */
type AgentRow = AgentView & { readonly slot?: true };

function agentLine(frame: Frame, agent: AgentRow, now: number): string {
  const gap = 4;
  const what = Math.max(
    8,
    frame.inner - COLUMNS.name - COLUMNS.task - COLUMNS.phase - COLUMNS.time - gap,
  );
  const [phaseText, phaseStyle] = PHASES[agent.phase];
  const text = agent.text === '' ? '—' : agent.text;
  const activity: Span[] =
    agent.phase === 'work'
      ? [[`${describeWork(text)} `], [`(${text})`, 'dim']]
      : [[text, agent.phase === 'idle' ? 'dim' : PHASES[agent.phase][1]]];
  return line(frame, [
    [fit(agent.name, COLUMNS.name), 'bold'],
    [' '],
    [fit(agent.task ?? '—', COLUMNS.task)],
    [' '],
    [fit(phaseText, COLUMNS.phase), phaseStyle],
    [' '],
    ...clip(activity, what),
    [' '],
    [(agent.slot ? '' : duration(now - agent.since)).padStart(COLUMNS.time), 'dim'],
  ]);
}

/** Единственный исполнитель и его текущее состояние. */
function agentRows(board: Board): AgentRow[] {
  const agents: AgentRow[] = board.agents().filter((agent) => agent.name === MAIN_AGENT);
  if (agents.length === 0)
    agents.push({ name: MAIN_AGENT, phase: 'idle', text: 'запускается…', since: board.startedAt });
  return agents;
}

function agentsSection(frame: Frame, board: Board, rows: readonly AgentRow[]): string[] {
  const now = board.time;
  const working = rows.filter((agent) => agent.phase === 'work').length;
  const title: Span[] = [['АГЕНТ', 'bold'], [` · работает ${working}`]];
  const what = frame.inner - COLUMNS.name - COLUMNS.task - COLUMNS.phase - COLUMNS.time - 4;
  return [
    rule(frame, ['├', '┤'], title),
    line(frame, [
      [
        [
          fit('АГЕНТ', COLUMNS.name),
          fit('ЗАДАЧА', COLUMNS.task),
          fit('СОСТОЯНИЕ', COLUMNS.phase),
          fit('ЧТО ДЕЛАЕТ', Math.max(8, what)),
          'ВРЕМЯ'.padStart(COLUMNS.time),
        ].join(' '),
        'dim',
      ],
    ]),
    ...rows.map((agent) => agentLine(frame, agent, now)),
  ];
}

function stageSection(frame: Frame, board: Board): string[] {
  const { stage } = board;
  if (stage === undefined)
    return [
      rule(frame, ['├', '┤'], [['ЭТАП', 'bold']]),
      line(frame, [['STATUS.md не прочитан — подробности в журнале', 'dim']]),
    ];
  const left = Math.max(0, stage.total - stage.done - stage.review);
  const text = ` ${stage.done} из ${stage.total} готово · ${stage.review} на ревью · осталось ${left}`;
  const size = Math.max(10, Math.min(30, frame.inner - chars(text).length - 2));
  const done = stage.total === 0 ? 0 : Math.round((stage.done / stage.total) * size);
  const review = stage.total === 0 ? 0 : Math.round((stage.review / stage.total) * size);
  const rest = Math.max(0, size - done - review);
  return [
    rule(frame, ['├', '┤'], [[`ЭТАП ${stage.stage}`, 'bold'], [` · ветка ${stage.branch}`]]),
    line(frame, [
      ['['],
      ['█'.repeat(done), 'green'],
      ['▒'.repeat(Math.min(review, size - done)), 'yellow'],
      ['░'.repeat(rest), 'gray'],
      [']'],
      [text],
    ]),
    line(frame, [
      ['Дальше: ', 'dim'],
      [stage.next.length === 0 ? 'очередь пуста' : stage.next.join(' → ')],
    ]),
  ];
}

function totalsSection(frame: Frame, board: Board): string[] {
  const { totals } = board;
  return [
    rule(
      frame,
      ['├', '┤'],
      [['ЗА ЭТОТ ЗАПУСК', 'bold'], [` · ${duration(board.time - board.startedAt)}`]],
    ),
    line(frame, [
      [`задач готово ${totals.done}`, totals.done > 0 ? 'green' : undefined],
      [` · возвратов с ревью ${totals.returns}`],
      [` · сессий codex ${totals.sessions} (${duration(totals.sessionMs)})`],
      [' · CI '],
      [`✓ ${totals.ciGreen}`, 'green'],
      [' '],
      [`✗ ${totals.ciRed}`, totals.ciRed > 0 ? 'red' : 'dim'],
    ]),
  ];
}

function journalLine(frame: Frame, entry: LogLine): string {
  const stream = /^\[w(\d)/u.exec(entry.text)?.[1];
  const style =
    lineColor(entry.text) ??
    (stream === undefined ? undefined : STREAM_STYLES[(Number(stream) - 1) % STREAM_STYLES.length]);
  // Протокол бывает многострочным (хвост ответа codex): на экране — первая строка.
  const text = entry.text.split(/\r?\n/u, 1)[0] ?? '';
  return line(frame, [
    [`${clockText(entry.at)} `, 'dim'],
    [text, style],
  ]);
}

function journalSection(frame: Frame, board: Board, height: number): string[] {
  const entries = board.tail(height);
  const empty = Array.from({ length: height - entries.length }, () => line(frame, []));
  return [
    rule(
      frame,
      ['├', '┤'],
      [
        ['ЖУРНАЛ', 'bold'],
        ...(board.loopLog === '' ? [] : [[` · полный: ${board.loopLog}`, 'dim'] as Span]),
      ],
    ),
    ...entries.map((entry) => journalLine(frame, entry)),
    ...empty,
  ];
}

function footer(frame: Frame, board: Board): string[] {
  const last = board.lastLog;
  const status: Span[] =
    board.notice !== ''
      ? [[board.notice, 'cyan']]
      : last !== undefined
        ? [
            ['Лог последней сессии codex: ', 'dim'],
            [`${last.agent} ${last.path}`, 'dim'],
          ]
        : [];
  const key = (name: string, text: string): Span[] => [[`[${name}]`, 'bold'], [` ${text}  `]];
  return [
    rule(frame, ['├', '┤'], []),
    line(frame, status),
    line(frame, [...key('Enter', 'проверить сейчас'), ...key('Q', 'выход')]),
  ];
}

/**
 * Кадр экрана: ровно height строк по width клеток. Журнал занимает остаток высоты; в низком
 * окне разделы счётчиков и этапа уступают ему место.
 */
export function renderFrame(
  board: Board,
  width: number,
  height: number,
  colors: boolean,
): string[] {
  const paint: Paint = (text, style) =>
    colors && style !== undefined && text !== ''
      ? `\u001b[${STYLES[style]}m${text}\u001b[0m`
      : text;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    const message = `Окно ${width}×${height} мало: нужно хотя бы ${MIN_WIDTH}×${MIN_HEIGHT}`;
    return Array.from({ length: height }, (_, index) =>
      index === 0 ? fit(message, width) : ' '.repeat(width),
    );
  }
  const frame: Frame = { width, inner: width - 4, paint };
  const agents = board.agents();
  const stage = board.stage;
  const top = rule(
    frame,
    ['╭', '╮'],
    [['HexFront', 'bold'], [' · агентный цикл']],
    [
      ...(stage === undefined ? [] : [[`этап ${stage.stage} · ${stage.branch} · `] as Span]),
      [clockText(board.time), 'bold'],
    ],
  );
  const tail = [...footer(frame, board), rule(frame, ['╰', '╯'], [])];
  const table = agentsSection(frame, board, agentRows(board));
  // Причина ожидания сокращается, пока под ней остаётся журнал: низкое окно с 4 потоками.
  let head: string[] = [];
  for (let reason = REASON_LINES; reason >= 1; reason -= 1) {
    head = [top, ...banner(frame, board, agents, reason), ...table];
    if (head.length + tail.length + 1 + MIN_JOURNAL <= height) break;
  }
  const optional = [stageSection(frame, board), totalsSection(frame, board)];
  // Журнал с заголовком: высота минус обязательное; необязательные разделы — пока хватает места.
  let middle: string[] = [];
  for (const section of optional)
    if (height - head.length - tail.length - middle.length - section.length - 1 >= MIN_JOURNAL)
      middle = [...middle, ...section];
  const journal = Math.max(0, height - head.length - tail.length - middle.length - 1);
  const body = [...head, ...middle, ...journalSection(frame, board, journal)];
  // Не влезло — режется середина, а не низ: в нижней строке ответы на клавиши владельца.
  return [...body.slice(0, Math.max(0, height - tail.length)), ...tail].slice(0, height);
}
