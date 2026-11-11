// Комната: авторитетный матч sim, места людей, боты, туман и дельты по игроку.
// Не знает про сеть: соединение — интерфейс `Connection`, время и таймеры приходят снаружи.
import { randomBytes } from 'node:crypto';

import {
  encodeDelta,
  encodeMaskRle,
  encodeServerMessage,
  encodeSnapshot,
  ConfirmedViewDeltaStream,
  MAX_COMMANDS_PER_SECOND,
  MAX_QUERIES_PER_SECOND,
  type Query,
  slowLayerReuse,
  type JoinMode,
  type LobbyInfo,
  type S2C,
} from '@hexfront/protocol';
import {
  botCommands,
  buildMask,
  type BuildMaskKind,
  commanderCommands,
  createBotTickContext,
  createMatch,
  createPlayerViewContext,
  playerView,
  previewPath,
  selectionFor,
  step,
  supplyLevels,
  TICK_MS,
  type BotLevel,
  type Command,
  type GameEvent,
  type MapStatic,
  type MatchState,
  type PlayerCommand,
} from '@hexfront/sim';

/** Сколько секунд комната ждёт людей в открытом наборе, потом боты занимают свободные места. */
export const GATHER_SECONDS = 30;
/** Сколько секунд игрок может быть вне связи, пока его армиями не займётся бот. */
export const RECONNECT_SECONDS = 30;
/** Тиков без `viewAck`, после которых клиенту снова шлётся полный снимок. */
const ACK_STALE_TICKS = 100;
const BOT_LEVEL: BotLevel = 'medium';
/** Команд в очереди на тик от одного игрока; больше — отклоняются как `rateLimit`. */
const MAX_PENDING = 64;
/**
 * Сообщений вида в пути без подтверждения. Больше 1, чтобы при пинге в сотни миллисекунд вид шёл на
 * каждом тике, а не раз в круговую задержку; неподтверждённое окно держит память ограниченной.
 */
const SEND_WINDOW = 12;
/**
 * Полных снимков за тик на комнату. Старт матча и массовый реконнект иначе посылают снимок всем
 * людям на одном тике (десятки КБ на человека): тик комнаты, а с ним и остальных комнат, подвисает.
 * Остальные получают снимок в следующие тики, задержка — доли секунды.
 */
export const MAX_SNAPSHOTS_PER_TICK = 4;
/** События, копящиеся, пока игрок вне связи; старые вытесняются. */
const MAX_QUEUED_EVENTS = 256;

/** Сторона сети: комната шлёт текст и может закрыть соединение. */
export interface Connection {
  send(text: string): void;
  close(): void;
}

export interface RoomOptions {
  readonly id: string;
  readonly mode: JoinMode;
  readonly map: MapStatic;
  /** Имя карты для клиента: он собирает такую же карту у себя (`gen` — генерация по сиду). */
  readonly mapName: string;
  readonly seed: number;
  /** Всего игроков в матче; людей не больше этого числа, остальные — боты. */
  readonly size: number;
  readonly fog: boolean;
  readonly now: () => number;
}

export type Phase = 'lobby' | 'running' | 'ended';

interface Seat {
  readonly playerId: number;
  readonly token: string;
  readonly nick: string;
  conn: Connection | null;
  readonly stream: ConfirmedViewDeltaStream;
  pending: Command[];
  events: GameEvent[];
  /** Выбранный гекс и последняя отправленная карточка (JSON): шлём только изменения. */
  selected: number | null;
  lastSel: string | null;
  queryStart: number;
  queryCount: number;
  /** Последний исполненный `seq` команды: повторы после обрыва не исполняются второй раз. */
  lastSeq: number;
  waitingTicks: number;
  droppedAt: number | null;
  botControlled: boolean;
  windowStart: number;
  windowCount: number;
}

/** События, видимые игроку: свои, политические и касающиеся его; чужие внутренние — нет. */
export function eventsFor(events: readonly GameEvent[], playerId: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (const e of events) {
    switch (e.t) {
      case 'commandRejected':
        if (e.playerId === playerId && !e.auto) out.push(e);
        break;
      case 'cityCaptured':
      case 'playerEliminated':
      case 'matchWon':
        out.push(e);
        break;
      case 'warDeclared':
      case 'treatyMade':
      case 'treatyBroken':
      case 'treatyOffered':
        if (e.playerId === playerId || e.targetId === playerId) out.push(e);
        break;
      default:
        if (e.playerId === playerId) out.push(e);
    }
  }
  return out;
}

export class Room {
  public readonly id: string;
  public readonly mode: JoinMode;
  public phase: Phase = 'lobby';
  public state: MatchState | null = null;
  private readonly options: RoomOptions;
  private readonly seats: Seat[] = [];
  private gatherEndsAt: number | null = null;
  private nextToken = 0;
  /** Метрики: сколько тиков и сколько мс ушло на шаги sim, виды и отправку. */
  public readonly stats = { ticks: 0, stepMs: 0, viewMs: 0, bytes: 0, messages: 0 };

  public constructor(options: RoomOptions) {
    this.options = options;
    this.id = options.id;
    this.mode = options.mode;
  }

  /** Людей в комнате (включая отключившихся, чьё место ещё держится). */
  public get humans(): number {
    return this.seats.length;
  }

  /** Есть ли хоть одно живое соединение (пустые комнаты хаб убирает). */
  public hasConnected(): boolean {
    return this.seats.some((s) => s.conn !== null);
  }

  /** Есть ли свободное место для нового человека. */
  public get hasFreeSeat(): boolean {
    return this.phase === 'lobby' && this.seats.length < this.options.size;
  }

  /** Состояние набора для табло лобби. */
  public lobbyInfo(): LobbyInfo {
    const left =
      this.gatherEndsAt === null
        ? null
        : Math.max(0, Math.ceil((this.gatherEndsAt - this.options.now()) / 1000));
    return {
      room: this.id,
      humans: this.seats.length,
      max: this.options.size,
      startsInS: left,
      open: this.mode === 'open',
    };
  }

  /**
   * Садит человека на свободное место в наборе.
   * @returns токен сессии и id игрока либо `null`, если мест нет или матч идёт
   */
  public join(conn: Connection, nick: string): { token: string; playerId: number } | null {
    if (!this.hasFreeSeat) return null;
    const playerId = this.seats.length;
    const token = `${this.id}-${playerId}-${(this.nextToken += 1)}-${randomPart()}`;
    this.seats.push({
      playerId,
      token,
      nick,
      conn,
      stream: new ConfirmedViewDeltaStream(SEND_WINDOW),
      pending: [],
      events: [],
      selected: null,
      lastSel: null,
      queryStart: 0,
      queryCount: 0,
      lastSeq: 0,
      waitingTicks: 0,
      droppedAt: null,
      botControlled: false,
      windowStart: 0,
      windowCount: 0,
    });
    if (this.mode === 'open' && this.gatherEndsAt === null) {
      this.gatherEndsAt = this.options.now() + GATHER_SECONDS * 1000;
    }
    this.sendWelcome(this.seats[playerId] as Seat);
    if (this.seats.length >= this.options.size) this.start();
    else this.broadcastLobby();
    return { token, playerId };
  }

  /**
   * Возвращает игрока на его место по токену (реконнект). Старое соединение закрывается.
   * @returns id игрока или `null`, если токена в этой комнате нет
   */
  public reconnect(conn: Connection, token: string, have?: number): number | null {
    const seat = this.seats.find((s) => s.token === token);
    if (seat === undefined) return null;
    seat.conn?.close();
    seat.conn = conn;
    seat.droppedAt = null;
    seat.waitingTicks = 0;
    // Клиент помнит базу — продолжаем дельтами (экономит полный снимок на слабой связи).
    seat.lastSel = null;
    const resumed =
      have === undefined || this.phase !== 'running' ? null : seat.stream.resume(have);
    if (resumed === null) {
      seat.stream.reset();
      seat.events = [];
    } else {
      // События сообщений, которые клиент не применил, возвращаются в очередь.
      seat.events = [...resumed.events, ...seat.events];
    }
    if (seat.botControlled) this.takeBack(seat);
    this.sendWelcome(seat);
    if (this.phase === 'lobby') this.send(seat, { t: 'lobby', info: this.lobbyInfo() });
    return seat.playerId;
  }

  /** Соединение игрока оборвалось: место держится RECONNECT_SECONDS. */
  public disconnect(conn: Connection): void {
    const seat = this.seats.find((s) => s.conn === conn);
    if (seat === undefined) return;
    seat.conn = null;
    seat.droppedAt = this.options.now();
  }

  /** Принимает команду игрока: ограничение частоты, очередь до ближайшего тика. */
  public command(conn: Connection, seq: number, cmd: Command): void {
    const seat = this.seats.find((s) => s.conn === conn);
    if (seat === undefined) return;
    if (this.phase !== 'running') {
      this.send(seat, { t: 'rejected', seq, reason: 'bad' });
      return;
    }
    // Повтор после обрыва: уже исполнено или стоит в очереди — только подтверждаем.
    if (seq <= seat.lastSeq) {
      this.send(seat, { t: 'ack', seq: seat.lastSeq });
      return;
    }
    seat.lastSeq = seq;
    const now = this.options.now();
    if (now - seat.windowStart >= 1000) {
      seat.windowStart = now;
      seat.windowCount = 0;
    }
    seat.windowCount += 1;
    if (seat.windowCount > MAX_COMMANDS_PER_SECOND || seat.pending.length >= MAX_PENDING) {
      this.send(seat, { t: 'rejected', seq, reason: 'rateLimit' });
      return;
    }
    seat.pending.push(cmd);
    this.send(seat, { t: 'ack', seq });
  }

  /** Клиент применил сообщение с этим тиком: оно становится базой следующей дельты. */
  public viewAck(conn: Connection, tick: number): void {
    const seat = this.seats.find((s) => s.conn === conn);
    if (seat === undefined) return;
    seat.stream.acknowledge(tick);
    seat.waitingTicks = 0;
  }

  /** Игрок выбрал гекс: карточка придёт сразу и затем при каждом изменении. */
  public select(conn: Connection, hex: number | null): void {
    const seat = this.seats.find((s) => s.conn === conn);
    const state = this.state;
    if (seat === undefined || state === null || this.phase !== 'running') return;
    const size = state.map.width * state.map.height;
    seat.selected = hex !== null && hex >= 0 && hex < size ? hex : null;
    seat.lastSel = null;
    this.pushSelection(seat, state);
  }

  /**
   * Расчёт по полному состоянию: прогноз пути и маски карты. Лимит запросов на игрока; ответ — с тем же `id`.
   */
  public query(conn: Connection, id: number, q: Query): void {
    const seat = this.seats.find((s) => s.conn === conn);
    const state = this.state;
    if (seat === undefined || state === null || this.phase !== 'running') return;
    const now = this.options.now();
    if (now - seat.queryStart >= 1000) {
      seat.queryStart = now;
      seat.queryCount = 0;
    }
    seat.queryCount += 1;
    if (seat.queryCount > MAX_QUERIES_PER_SECOND) return;
    if (q.kind === 'path') {
      const size = state.map.width * state.map.height;
      const points = [q.to, ...q.via];
      if (points.some((hex) => hex < 0 || hex >= size) || q.unitIds.length > 512) return;
      this.send(seat, {
        t: 'pathPreview',
        id,
        preview: previewPath(state, seat.playerId, q.unitIds, q.to, q.via),
      });
      return;
    }
    const mask =
      q.mode === 'supply'
        ? supplyLevels(state, seat.playerId)
        : buildMask(state, seat.playerId, q.mode.slice('build:'.length) as BuildMaskKind);
    this.send(seat, { t: 'mapMask', id, mode: q.mode, rle: encodeMaskRle(mask) });
  }

  /** Карточка гекса уходит, если гекс виден игроку и карточка изменилась с прошлой отправки. */
  private pushSelection(seat: Seat, state: MatchState): void {
    if (seat.conn === null) return;
    const hex = seat.selected;
    const visible =
      hex !== null && (!state.fog || state.vision?.visible[seat.playerId]?.[hex] === 1);
    const sel = hex !== null && visible ? selectionFor(state, seat.playerId, hex) : null;
    const json = JSON.stringify(sel);
    if (json === seat.lastSel) return;
    seat.lastSel = json;
    this.send(seat, { t: 'selection', sel });
  }

  /** Клиент потерял базу: следующим уйдёт полный снимок. */
  public resync(conn: Connection): void {
    const seat = this.seats.find((s) => s.conn === conn);
    if (seat === undefined) return;
    seat.stream.reset();
    seat.waitingTicks = 0;
  }

  /** Хозяин (первое место) запускает матч раньше срока. */
  public startEarly(conn: Connection): void {
    if (this.phase === 'lobby' && this.seats[0]?.conn === conn) this.start();
  }

  /** Вызывается таймером: в открытом наборе по истечении времени запускает матч. */
  public poll(): void {
    if (this.phase !== 'lobby' || this.gatherEndsAt === null) return;
    if (this.options.now() >= this.gatherEndsAt) this.start();
    else this.broadcastLobby();
  }

  /** Запускает матч: люди — игроки 0..n−1, остальные места занимают боты. */
  public start(): void {
    if (this.phase !== 'lobby' || this.seats.length === 0) return;
    const { size, map, seed, fog } = this.options;
    const setup = Array.from({ length: size }, (_, i) => ({
      name: this.seats[i]?.nick ?? `Бот ${i - this.seats.length + 1}`,
    }));
    const state = createMatch(map, setup, seed, { fog, diplomacy: true });
    for (const seat of this.seats) this.takeBack(seat, state);
    this.state = state;
    this.phase = 'running';
    for (const seat of this.seats) {
      this.send(seat, { t: 'start', tick: state.tick });
      seat.stream.reset();
    }
  }

  /** Один тик матча: команды людей, боты и commander, `step`, затем виды и дельты. */
  public tick(): void {
    const state = this.state;
    if (this.phase !== 'running' || state === null) return;
    const started = performance.now();
    const botIds = this.botIds();
    const context = createBotTickContext(state);
    const levels = state.players.map(() => BOT_LEVEL);
    const commands: PlayerCommand[] = [];
    for (const seat of this.seats) {
      if (seat.botControlled) continue;
      for (const cmd of seat.pending) commands.push({ playerId: seat.playerId, cmd });
      seat.pending = [];
    }
    commands.push(...commanderCommands(state, botIds, levels, context));
    commands.push(...botCommands(state, botIds, levels, context));
    this.handOverDropped();
    step(state, commands);
    const stepped = performance.now();
    this.stats.stepMs += stepped - started;
    this.stats.ticks += 1;
    this.sendViews(state);
    this.stats.viewMs += performance.now() - stepped;
    if (state.winner >= 0) this.finish(state);
  }

  /** Закрывает соединения и помечает комнату завершённой. */
  public close(): void {
    this.phase = 'ended';
    for (const seat of this.seats) seat.conn?.close();
  }

  private botIds(): number[] {
    const humans = new Set(this.seats.filter((s) => !s.botControlled).map((s) => s.playerId));
    const ids: number[] = [];
    for (let id = 0; id < this.options.size; id += 1) if (!humans.has(id)) ids.push(id);
    return ids;
  }

  /** Люди ведут армии сами: автокомандование выключено, как в локальной игре. */
  private takeBack(seat: Seat, state: MatchState | null = this.state): void {
    seat.botControlled = false;
    const me = state?.players[seat.playerId];
    if (me === undefined || state === null) return;
    me.autoCommand = false;
    for (const army of state.armies) if (army.owner === seat.playerId) army.auto = false;
  }

  /** Через RECONNECT_SECONDS без связи армии игрока переходят командиру и боту (docs/gdd/08-match.md). */
  private handOverDropped(): void {
    const state = this.state;
    if (state === null) return;
    const now = this.options.now();
    for (const seat of this.seats) {
      if (seat.droppedAt === null || seat.botControlled) continue;
      if (now - seat.droppedAt < RECONNECT_SECONDS * 1000) continue;
      seat.botControlled = true;
      const me = state.players[seat.playerId];
      if (me !== undefined) me.autoCommand = true;
      for (const army of state.armies) if (army.owner === seat.playerId) army.auto = true;
    }
  }

  private sendViews(state: MatchState): void {
    const context = createPlayerViewContext(state);
    let snapshots = 0;
    for (const seat of this.seats) {
      if (seat.botControlled) continue;
      seat.events.push(...eventsFor(state.events, seat.playerId));
      if (seat.events.length > MAX_QUEUED_EVENTS)
        seat.events.splice(0, seat.events.length - MAX_QUEUED_EVENTS);
      if (seat.conn === null) continue;
      if (seat.stream.isWaiting) {
        seat.waitingTicks += 1;
        if (seat.waitingTicks < ACK_STALE_TICKS) continue;
        // Подтверждение потерялось: начинаем с полного снимка.
        seat.stream.reset();
        seat.waitingTicks = 0;
        seat.events = [];
      }
      if (seat.stream.willSendSnapshot && snapshots >= MAX_SNAPSHOTS_PER_TICK) continue;
      if (seat.selected !== null || seat.lastSel !== null) this.pushSelection(seat, state);
      const reuse = slowLayerReuse(seat.stream.baseView, seat.stream.isSlowSync(state.tick));
      const view = playerView(state, seat.playerId, context, reuse);
      const transport = seat.stream.next(view, seat.events);
      if (transport === null) continue;
      if (transport.kind === 'snapshot') snapshots += 1;
      seat.events = [];
      const text =
        transport.kind === 'snapshot'
          ? encodeSnapshot(transport.snapshot)
          : encodeDelta(transport.delta);
      this.sendText(seat, text);
    }
  }

  private finish(state: MatchState): void {
    this.phase = 'ended';
    for (const seat of this.seats) {
      this.send(seat, { t: 'end', winner: state.winner, tick: state.tick });
    }
  }

  private sendWelcome(seat: Seat): void {
    this.send(seat, {
      t: 'welcome',
      playerId: seat.playerId,
      token: seat.token,
      room: this.id,
      tickMs: TICK_MS,
      map: this.options.mapName,
      seed: this.options.seed,
      players: this.options.size,
      fog: this.options.fog,
    });
  }

  private broadcastLobby(): void {
    const info = this.lobbyInfo();
    for (const seat of this.seats) this.send(seat, { t: 'lobby', info });
  }

  private send(seat: Seat, message: S2C): void {
    this.sendText(seat, encodeServerMessage(message));
  }

  private sendText(seat: Seat, text: string): void {
    if (seat.conn === null) return;
    this.stats.bytes += text.length;
    this.stats.messages += 1;
    seat.conn.send(text);
  }
}

function randomPart(): string {
  return randomBytes(18).toString('base64url');
}
