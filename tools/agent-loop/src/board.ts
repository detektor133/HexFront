// Панель консоли цикла: кто из агентов что делает, этап и счётчики запуска. Только данные и
// текст строк — вывод в терминал и клавиши в console-ui.ts.
import { minutes } from './codex.ts';
import { parseQueue, statusBranch, statusStage, taskMark } from './stage-file.ts';
import { MAX_STREAMS } from './state.ts';

/** Агент занят, ждёт владельца или паузы, свободен. */
export type AgentPhase = 'work' | 'wait' | 'idle';
interface AgentRow {
  readonly phase: AgentPhase;
  readonly text: string;
  /** С какого времени (мс) идёт это состояние. */
  readonly since: number;
  readonly task?: string;
  /** Лог последней сессии codex агента. */
  readonly log?: string;
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

const PHASE_WORDS: Readonly<Record<AgentPhase, string>> = {
  work: 'работает',
  wait: 'ждёт',
  idle: 'свободен',
};
const NEXT_SHOWN = 4;
/** Главный каталог: Issues, `slow`, закрытие этапа и задачи, когда потоков нет. */
export const MAIN_AGENT = 'главный';

const agentOrder = (name: string): number =>
  name === MAIN_AGENT ? 0 : Number(name.replace(/^w/, '')) || MAX_STREAMS + 1;

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
  /** Вызывается после каждого изменения: консоль перерисовывает панель. */
  onChange: () => void = () => undefined;
  private readonly rows = new Map<string, AgentRow>();
  private requested: number | undefined;
  readonly startedAt: number;
  // Без параметра-свойства в конструкторе: цикл запускается node с удалением типов.
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
    this.startedAt = now();
  }

  private set(agent: string, phase: AgentPhase, text: string, extra: Partial<AgentRow> = {}): void {
    const before = this.rows.get(agent);
    const task = extra.task ?? before?.task;
    const log = extra.log ?? before?.log;
    this.rows.set(agent, {
      phase,
      // Строка панели — одна строка экрана: причина ожидания бывает выводом git на много строк.
      text: text.trim().split(/\r?\n/u, 1)[0] ?? '',
      since: this.now(),
      ...(task === undefined ? {} : { task }),
      ...(log === undefined ? {} : { log }),
    });
    this.onChange();
  }

  /** Агент взял задачу: она видна в строке, пока он её не отпустит. */
  task(agent: string, task: string): void {
    const row = this.rows.get(agent);
    // Время текущего состояния не сбрасывается: агент продолжает то же дело.
    this.rows.set(agent, { phase: 'idle', text: '', since: this.now(), ...row, task });
    this.onChange();
  }

  begin(agent: string, text: string): void {
    this.set(agent, 'work', text);
  }

  end(agent: string, text: string, log?: string): void {
    this.set(agent, 'idle', text, log === undefined ? {} : { log });
  }

  wait(agent: string, reason: string): void {
    this.set(agent, 'wait', reason);
  }

  /** Поток отпустил задачу (влита или отменена): строки больше нет. */
  remove(agent: string): void {
    if (this.rows.delete(agent)) this.onChange();
  }

  count(metric: keyof Totals, value = 1): void {
    this.totals[metric] += value;
    this.onChange();
  }

  /** Просьба владельца с клавиатуры: число агентов от 1 до MAX_STREAMS. */
  requestLimit(count: number): number {
    const limit = Math.min(MAX_STREAMS, Math.max(1, Math.trunc(count)));
    this.requested = limit;
    this.onChange();
    return limit;
  }

  /** Просьба, ещё не применённая циклом; после чтения сбрасывается. */
  takeLimit(): number | undefined {
    const limit = this.requested;
    this.requested = undefined;
    return limit;
  }

  /** Предел, который видит владелец: ещё не применённая просьба или текущий. */
  get shownLimit(): number {
    return this.requested ?? this.limit();
  }

  get working(): number {
    return [...this.rows.values()].filter((row) => row.phase === 'work').length;
  }

  /** Строки панели без цвета; ширина обрезается в консоли. */
  render(): string[] {
    const now = this.now();
    const limit = this.shownLimit;
    const stage = this.stage;
    const header = [
      'agent:run',
      ...(stage === undefined ? [] : [`этап ${stage.stage}`, stage.branch]),
      `работают ${this.working} · предел ${limit}${this.requested === undefined ? '' : ' после шага'}`,
    ].join(' · ');
    const rows = [...this.rows.entries()]
      .sort(([a], [b]) => agentOrder(a) - agentOrder(b))
      .map(([name, row]) =>
        [
          name.padEnd(8),
          PHASE_WORDS[row.phase].padEnd(9),
          (row.task ?? '').padEnd(10),
          `${row.text}${row.phase === 'idle' ? '' : ` · ${minutes(now - row.since)}`}`,
        ].join(' '),
      );
    const { totals } = this;
    const lines = [`── ${header} ──`, ...(rows.length === 0 ? ['(агенты ещё не начали)'] : rows)];
    if (stage !== undefined)
      lines.push(
        `этап: готово ${stage.done} из ${stage.total} · на ревью ${stage.review} · дальше ${stage.next.join(', ') || '—'}`,
      );
    lines.push(
      `за ${minutes(now - this.startedAt)}: задач ${totals.done} · ВОЗВРАТ ${totals.returns} · сессий codex ${totals.sessions} (${minutes(totals.sessionMs)}) · CI зелёных ${totals.ciGreen}, красных ${totals.ciRed}`,
    );
    const logs = [...this.rows.entries()]
      .filter(([, row]) => row.log !== undefined)
      .map(([name, row]) => `${name} ${row.log ?? ''}`);
    lines.push(`логи: ${[this.loopLog, ...logs].filter(Boolean).join(' · ') || '—'}`);
    return lines;
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
