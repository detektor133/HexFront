// Модель экрана консоли цикла: кто из агентов что делает, этап, счётчики запуска и журнал.
// Только данные — рисует screen.ts, клавиши и терминал — console-ui.ts.
import { parseQueue, statusBranch, statusStage, taskMark } from './stage-file.ts';
import { MAX_STREAMS } from './state.ts';

/** Агент занят, ждёт владельца, стоит на паузе после сбоя, свободен. */
export type AgentPhase = 'work' | 'wait' | 'pause' | 'idle';
export interface AgentView {
  readonly name: string;
  readonly phase: AgentPhase;
  readonly text: string;
  /** С какого времени (мс) идёт это состояние. */
  readonly since: number;
  readonly task?: string;
  /** Лог последней сессии codex агента. */
  readonly log?: string;
}
export interface LogLine {
  /** Время записи, мс. */
  readonly at: number;
  readonly text: string;
}
/** Сводка этапа из STATUS и файла этапа. */
export interface StageSummary {
  readonly stage: string;
  readonly branch: string;
  readonly done: number;
  readonly review: number;
  readonly total: number;
  /** Ближайшие незакрытые задачи «Очереди». */
  readonly next: readonly string[];
}
/** Счётчики с запуска цикла. */
export interface Totals {
  done: number;
  returns: number;
  sessions: number;
  sessionMs: number;
  ciGreen: number;
  ciRed: number;
}

const NEXT_SHOWN = 5;
/** Сколько строк журнала держать в памяти: экран показывает хвост, весь протокол — в файле. */
const LOG_KEPT = 500;
/** Главный каталог: Issues, `slow`, закрытие этапа и задачи, когда потоков нет. */
export const MAIN_AGENT = 'главный';

const agentOrder = (name: string): number =>
  name === MAIN_AGENT ? 0 : Number(name.replace(/^w/u, '')) || MAX_STREAMS + 1;

export class Board {
  readonly totals: Totals = {
    done: 0,
    returns: 0,
    sessions: 0,
    sessionMs: 0,
    ciGreen: 0,
    ciRed: 0,
  };
  /** Предел агентов из памяти цикла; задаёт агентный цикл при старте. */
  limit: () => number = () => 1;
  stage: StageSummary | undefined;
  /** Лог цикла за день. */
  loopLog = '';
  /** Лог последней сессии codex среди всех агентов: самый свежий разговор для разбора. */
  lastLog: { readonly agent: string; readonly path: string } | undefined;
  /** Короткое сообщение консоли владельцу (подтверждение клавиши), пока его не сменит другое. */
  notice = '';
  /** Вызывается после каждого изменения: консоль перерисовывает экран. */
  onChange: () => void = () => undefined;
  readonly startedAt: number;
  private readonly rows = new Map<string, AgentView>();
  private readonly lines: LogLine[] = [];
  private requested: number | undefined;
  // Без параметра-свойства в конструкторе: цикл запускается node с удалением типов.
  private readonly clock: () => number;

  constructor(now: () => number) {
    this.clock = now;
    this.startedAt = now();
  }

  get time(): number {
    return this.clock();
  }

  private set(agent: string, phase: AgentPhase, text: string, log?: string): void {
    const before = this.rows.get(agent);
    const task = before?.task;
    const shownLog = log ?? before?.log;
    this.rows.set(agent, {
      name: agent,
      phase,
      // Строка агента — одна строка экрана: причина ожидания бывает выводом git на много строк.
      text: text.trim().split(/\r?\n/u, 1)[0] ?? '',
      since: this.clock(),
      ...(task === undefined ? {} : { task }),
      ...(shownLog === undefined ? {} : { log: shownLog }),
    });
    this.onChange();
  }

  /** Агент взял задачу: она видна в строке, пока он её не отпустит. */
  task(agent: string, task: string): void {
    const row = this.rows.get(agent);
    // Время текущего состояния не сбрасывается: агент продолжает то же дело.
    this.rows.set(agent, {
      name: agent,
      phase: 'idle',
      text: '',
      since: this.clock(),
      ...row,
      task,
    });
    this.onChange();
  }

  begin(agent: string, text: string): void {
    this.set(agent, 'work', text);
  }

  end(agent: string, text: string, log?: string): void {
    if (log !== undefined) this.lastLog = { agent, path: log };
    this.set(agent, 'idle', text, log);
  }

  /** Ждёт владельца: Issue, ответа на вопрос, задачи владельца. */
  wait(agent: string, reason: string): void {
    this.set(agent, 'wait', reason);
  }

  /** Пауза после сбоя (лимит codex, сеть): снимется сама. */
  pause(agent: string, reason: string): void {
    this.set(agent, 'pause', reason);
  }

  /** Поток отпустил задачу (влита или отменена): строки больше нет. */
  remove(agent: string): void {
    if (this.rows.delete(agent)) this.onChange();
  }

  count(metric: keyof Totals, value = 1): void {
    this.totals[metric] += value;
    this.onChange();
  }

  /** Строка протокола цикла в журнал экрана. */
  log(text: string): void {
    this.lines.push({ at: this.clock(), text });
    if (this.lines.length > LOG_KEPT) this.lines.splice(0, this.lines.length - LOG_KEPT);
    this.onChange();
  }

  /** Последние строки журнала, старые первыми. */
  tail(count: number): readonly LogLine[] {
    return count <= 0 ? [] : this.lines.slice(-count);
  }

  /** Агенты по порядку: главный, затем потоки w1…wN. */
  agents(): readonly AgentView[] {
    return [...this.rows.values()].sort((a, b) => agentOrder(a.name) - agentOrder(b.name));
  }

  /**
   * Просьба владельца с клавиатуры: число агентов от 1 до MAX_STREAMS. Просьба, равная
   * текущему пределу, снимает прежнюю: применять нечего.
   */
  requestLimit(count: number): number {
    const limit = Math.min(MAX_STREAMS, Math.max(1, Math.trunc(count)));
    this.requested = limit === this.limit() ? undefined : limit;
    this.onChange();
    return limit;
  }

  /** Просьба, ещё не применённая циклом; после чтения сбрасывается. */
  takeLimit(): number | undefined {
    const limit = this.requested;
    this.requested = undefined;
    if (limit !== undefined) this.onChange();
    return limit;
  }

  /** Просьба, которую цикл ещё не применил. */
  get pendingLimit(): number | undefined {
    return this.requested;
  }

  /** Предел, который видит владелец: ещё не применённая просьба или текущий. */
  get shownLimit(): number {
    return this.requested ?? this.limit();
  }

  get working(): number {
    return [...this.rows.values()].filter((row) => row.phase === 'work').length;
  }
}

/** Сводка этапа: отметки задач «Очереди» и ближайшие незакрытые. */
export function stageSummary(status: string, stageText: string): StageSummary {
  const queue = parseQueue(status);
  const marks = queue.map((task) => taskMark(stageText, task));
  return {
    stage: statusStage(status) ?? '?',
    branch: statusBranch(status) ?? '?',
    done: marks.filter((mark) => mark === 'x' || mark === '—').length,
    review: marks.filter((mark) => mark === '~').length,
    total: queue.length,
    next: queue.filter((_, index) => marks[index] === ' ').slice(0, NEXT_SHOWN),
  };
}
