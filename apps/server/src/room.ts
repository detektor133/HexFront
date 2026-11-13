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
  LOBBY_PLAYER_MAPS,
  type Query,
  slowLayerReuse,
  type JoinMode,
  type LobbyInfo,
  type LobbyLevel,
  type LobbyMap,
  type MarkKind,
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
  FP,
  intDiv,
  isAllied,
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

import { staticMap } from './maps.ts';

/** Сколько секунд комната ждёт людей в открытом наборе, потом боты занимают свободные места. */
export const GATHER_SECONDS = 30;
/**
 * До какого тика в идущую открытую игру можно подсесть на место бота (4 минуты): война ботов
 * начинается на 5-й минуте, до неё у бота ещё мало отвоёвано. Так комнаты наполняются людьми
 * вместо десятков полупустых комнат с ботами (цена комнаты почти не зависит от числа людей).
 */
export const LATE_JOIN_TICKS = 2400;
/** Сколько секунд игрок может быть вне связи, пока его армиями не займётся бот. */
export const RECONNECT_SECONDS = 30;
/** Зрителей в одной комнате; больше — отказ `roomFull`. */
export const MAX_SPECTATORS = 20;
/** Чат: не больше CHAT_BURST сообщений и меток за CHAT_WINDOW_MS; верхний предел игроков в комнате. */
/** Диапазон зерна новой случайной карты (в протоколе зерно — до 2 млрд). */
const REMATCH_SEED_RANGE = 2_000_000_000;
const CHAT_WINDOW_MS = 4000;
const CHAT_BURST = 4;
/** Сколько секунд зритель без связи держит место, потом оно освобождается. */
const SPECTATOR_KEEP_SECONDS = 120;
/** Тиков без `viewAck`, после которых клиенту снова шлётся полный снимок. */
const ACK_STALE_TICKS = 100;
/** Игроков на «Европе» по умолчанию (как в меню «Против ботов»). */
const EUROPE_DEFAULT = 12;
/** Сложность комнаты (меню) → профиль ботов sim: `hard` — профиль `medium`. */
const BOT_LEVELS: Readonly<Record<LobbyLevel, BotLevel>> = {
  easy: 'easy',
  normal: 'normal',
  hard: 'medium',
};
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
  /** Тиков с начала матча, пока можно подсесть на место бота; 0 — подсадка выключена. */
  readonly lateJoinTicks?: number;
  readonly id: string;
  readonly mode: JoinMode;
  readonly map: MapStatic;
  /** Имя карты для клиента: он собирает такую же карту у себя (`gen` — генерация по сиду). */
  readonly mapName: string;
  readonly seed: number;
  /** Карта по сиду для `configure`; нет — карту сменить нельзя. */
  readonly makeMap?: (seed: number, size: number) => MapStatic;
  /** Всего игроков в матче; людей не больше этого числа, остальные — боты. */
  readonly size: number;
  readonly fog: boolean;
  readonly now: () => number;
}

export type Phase = 'lobby' | 'running' | 'ended';

interface Seat {
  /** В лобби номер условный (по порядку входа), окончательный задаётся при старте. */
  playerId: number;
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
  /** Зритель: сидит вне игроков, всегда смотрит чужими глазами. */
  spectator: boolean;
  /** Чьими глазами смотрит выбывший игрок; `null` — своими (обычная игра). */
  watching: number | null;
  windowStart: number;
  windowCount: number;
  /** Готов к старту (закрытая комната) и выбранная стартовая точка (индекс в карте). */
  ready: boolean;
  spawn: number | null;
  /** Времена последних сообщений чата, мс: защита от потока. */
  chatAt: number[];
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
  /** Карта, сид и сложность ботов: хозяин закрытой комнаты меняет их до старта (`configure`). */
  private map: MapStatic;
  private seed: number;
  private mapName: LobbyMap;
  private size: number;
  /** Стартовых точек случайной карты (размер карты, выбирает хозяин). */
  private genSpawns: number;
  private level: LobbyLevel = 'hard';
  private readonly seats: Seat[] = [];
  private readonly spectators: Seat[] = [];
  private snapshotsThisTick = 0;
  private gatherEndsAt: number | null = null;
  private nextToken = 0;
  /** Метрики: сколько тиков и сколько мс ушло на шаги sim, виды и отправку. */
  public readonly stats = {
    ticks: 0,
    stepMs: 0,
    viewMs: 0,
    bytes: 0,
    messages: 0,
    /** Стадии последнего тика, мс: боты и командиры, шаг sim, виды и отправка. */
    last: { botsMs: 0, stepMs: 0, viewMs: 0 },
  };

  public constructor(options: RoomOptions) {
    this.options = options;
    this.map = options.map;
    this.seed = options.seed;
    this.mapName = 'gen';
    this.size = options.size;
    this.genSpawns = options.size;
    this.id = options.id;
    this.mode = options.mode;
  }

  /** Людей в комнате (включая отключившихся, чьё место ещё держится). */
  /** Людей с живым соединением: это и есть «онлайн» комнаты. */
  public get connected(): number {
    return this.seats.filter((s) => s.conn !== null).length;
  }

  /** Сглаженная цена тика комнаты, мс; 0 — ещё не измерена. */
  public costMs = 0;

  public get humans(): number {
    return this.seats.length;
  }

  /** Есть ли хоть одно живое соединение (пустые комнаты хаб убирает). */
  public hasConnected(): boolean {
    return this.seats.some((s) => s.conn !== null);
  }

  /** Есть ли свободное место для нового человека. */
  public get hasFreeSeat(): boolean {
    return this.phase === 'lobby' && this.seats.length < this.size;
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
      max: this.size,
      startsInS: left,
      open: this.mode === 'open',
      level: this.level,
      map: this.mapName,
      seats: this.seats.map((seat, index) => ({
        id: seat.playerId,
        nick: seat.nick,
        ready: seat.ready,
        host: index === 0,
        spawn: seat.spawn,
      })),
    };
  }

  /**
   * Хозяин закрытой комнаты меняет сложность ботов, карту и число игроков до старта (как в меню
   * «Против ботов»). Клиентам уходит новое приветствие (карта и число игроков в нём) и табло.
   */
  public configure(
    conn: Connection,
    patch: {
      level?: LobbyLevel;
      map?: LobbyMap;
      players?: number;
      seed?: number;
      genSpawns?: number;
    },
  ): void {
    if (this.phase !== 'lobby' || this.mode !== 'private' || this.seats[0]?.conn !== conn) return;
    if (patch.level !== undefined) this.level = patch.level;
    const mapName = patch.map ?? this.mapName;
    let size = this.size;
    if (patch.map !== undefined && patch.map !== this.mapName) {
      size =
        mapName === 'gen'
          ? this.options.size
          : LOBBY_PLAYER_MAPS.includes(mapName)
            ? EUROPE_DEFAULT
            : 2;
    }
    if (patch.players !== undefined) size = patch.players;
    const regenerate =
      mapName === 'gen' &&
      ((patch.seed !== undefined && patch.seed !== this.seed) ||
        (patch.genSpawns !== undefined && patch.genSpawns !== this.genSpawns));
    if (mapName === 'gen') {
      this.seed = patch.seed ?? this.seed;
      this.genSpawns = patch.genSpawns ?? this.genSpawns;
    }
    const known = mapName === 'gen' ? undefined : staticMap(mapName);
    const cap = known === undefined ? this.genSpawns : known.spawns.length;
    size = Math.min(cap, Math.max(size, this.seats.length, 2));
    if (mapName !== this.mapName || size !== this.size || regenerate) {
      const next =
        mapName === 'gen' ? this.options.makeMap?.(this.seed, this.genSpawns) : staticMap(mapName);
      if (next === undefined) return;
      this.map = next;
      if (mapName !== this.mapName) for (const seat of this.seats) seat.spawn = null;
      this.mapName = mapName;
      this.size = size;
    }
    for (const seat of this.seats) if (seat.conn !== null) this.sendWelcome(seat);
    this.broadcastLobby();
  }

  /**
   * Садит человека на свободное место в наборе.
   * @returns токен сессии и id игрока либо `null`, если мест нет или матч идёт
   */
  public join(conn: Connection, nick: string): { token: string; playerId: number } | null {
    if (this.phase === 'running') return this.lateJoin(conn, nick);
    if (!this.hasFreeSeat) return null;
    const playerId = this.seats.length;
    const token = `${this.id}-${playerId}-${(this.nextToken += 1)}-${randomPart()}`;
    this.seats.push(this.newSeat(playerId, token, nick, conn));
    if (this.mode === 'open' && this.gatherEndsAt === null) {
      this.gatherEndsAt = this.options.now() + GATHER_SECONDS * 1000;
    }
    this.sendWelcome(this.seats[playerId] as Seat);
    if (this.seats.length >= this.size) this.start();
    else this.broadcastLobby();
    return { token, playerId };
  }

  private seatOf(conn: Connection): Seat | undefined {
    return this.seats.find((s) => s.conn === conn) ?? this.spectators.find((s) => s.conn === conn);
  }

  /**
   * Сажает зрителя в идущий матч: вид игрока (сначала живого человека), приказов нет.
   * @returns токен и id игрока, с которого начат просмотр; `null`, если матч не идёт или зрителей много
   */
  public spectate(conn: Connection, nick: string): { token: string; playerId: number } | null {
    const state = this.state;
    if (this.phase !== 'running' || state === null) return null;
    if (this.spectators.length >= MAX_SPECTATORS) return null;
    const human = this.seats.find((s) => state.players[s.playerId]?.status === 'alive');
    const target = human?.playerId ?? state.players.find((p) => p.status === 'alive')?.id ?? 0;
    const token = `${this.id}-w${(this.nextToken += 1)}-${randomPart()}`;
    const seat = this.newSeat(target, token, nick, conn);
    seat.spectator = true;
    seat.watching = target;
    this.spectators.push(seat);
    this.sendWelcome(seat);
    this.send(seat, { t: 'start', tick: state.tick });
    return { token, playerId: target };
  }

  /** Можно ли сейчас подсесть на место бота в идущей открытой игре. */
  public get canLateJoin(): boolean {
    return this.freeBotSlot() !== null;
  }

  private freeBotSlot(): { id: number } | null {
    const state = this.state;
    const limit = this.options.lateJoinTicks ?? LATE_JOIN_TICKS;
    if (this.mode !== 'open' || this.phase !== 'running' || state === null) return null;
    if (state.tick >= limit) return null;
    const taken = new Set(this.seats.map((s) => s.playerId));
    return state.players.find((p) => !taken.has(p.id) && p.status === 'alive') ?? null;
  }

  /** Человек занимает место бота в идущей игре: его страна, армии и город с этого тика его. */
  private lateJoin(conn: Connection, nick: string): { token: string; playerId: number } | null {
    const slot = this.freeBotSlot();
    const state = this.state;
    if (slot === null || state === null) return null;
    const playerId = slot.id;
    const token = `${this.id}-${playerId}-${(this.nextToken += 1)}-${randomPart()}`;
    const seat = this.newSeat(playerId, token, nick, conn);
    this.seats.push(seat);
    const player = state.players[playerId];
    if (player !== undefined) player.name = nick;
    this.takeBack(seat);
    this.sendWelcome(seat);
    this.send(seat, { t: 'start', tick: state.tick });
    return { token, playerId };
  }

  private newSeat(playerId: number, token: string, nick: string, conn: Connection): Seat {
    return {
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
      spectator: false,
      watching: null,
      windowStart: 0,
      windowCount: 0,
      ready: false,
      spawn: null,
      chatAt: [],
    };
  }

  /**
   * Возвращает игрока на его место по токену (реконнект). Старое соединение закрывается.
   * @returns id игрока или `null`, если токена в этой комнате нет
   */
  public reconnect(conn: Connection, token: string, have?: number): number | null {
    const seat =
      this.seats.find((s) => s.token === token) ?? this.spectators.find((s) => s.token === token);
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
    // Возврат из меню в идущий матч: лобби-клиент по «start» переходит на экран игры.
    if (this.phase === 'running' && this.state !== null) {
      this.send(seat, { t: 'start', tick: this.state.tick });
    }
    if (this.phase === 'lobby' && !seat.spectator) {
      this.send(seat, { t: 'lobby', info: this.lobbyInfo(), host: this.seats[0] === seat });
    }
    return seat.playerId;
  }

  /** Соединение игрока оборвалось: место держится RECONNECT_SECONDS. */
  public disconnect(conn: Connection): void {
    const seat = this.seatOf(conn);
    if (seat === undefined) return;
    if (seat.spectator) {
      seat.conn = null;
      seat.droppedAt = this.options.now();
      return;
    }
    if (this.phase === 'lobby') {
      // До старта держать место не за чем: ушедший сразу освобождает его и не считается в онлайне.
      this.seats.splice(this.seats.indexOf(seat), 1);
      this.seats.forEach((s, index) => {
        s.playerId = index;
      });
      if (this.seats.length === 0) this.gatherEndsAt = null;
      else this.broadcastLobby();
      return;
    }
    seat.conn = null;
    seat.droppedAt = this.options.now();
  }

  /** Принимает команду игрока: ограничение частоты, очередь до ближайшего тика. */
  public command(conn: Connection, seq: number, cmd: Command): void {
    const seat = this.seatOf(conn);
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
    // Принимаем только следующий по порядку номер (первая команда места задаёт начало): пропуск значит,
    // что предыдущую не приняли, и клиент пришлёт всё заново. Иначе отказ по лимиту молча терял бы команды.
    if (seat.lastSeq > 0 && seq > seat.lastSeq + 1) {
      this.send(seat, { t: 'rejected', seq, reason: 'retry' });
      return;
    }
    // Наблюдатель только смотрит: команды из чужого интерфейса не исполняются.
    if (seat.watching !== null) {
      this.send(seat, { t: 'rejected', seq, reason: 'bad' });
      return;
    }
    const now = this.options.now();
    if (now - seat.windowStart >= 1000) {
      seat.windowStart = now;
      seat.windowCount = 0;
    }
    if (seat.windowCount >= MAX_COMMANDS_PER_SECOND || seat.pending.length >= MAX_PENDING) {
      // Номер не засчитан: клиент повторит эту и следующие команды позже.
      this.send(seat, { t: 'rejected', seq, reason: 'rateLimit' });
      return;
    }
    seat.windowCount += 1;
    seat.lastSeq = seq;
    seat.pending.push(cmd);
    this.send(seat, { t: 'ack', seq });
  }

  /** Клиент применил сообщение с этим тиком: оно становится базой следующей дельты. */
  public viewAck(conn: Connection, tick: number): void {
    const seat = this.seatOf(conn);
    if (seat === undefined) return;
    seat.stream.acknowledge(tick);
    seat.waitingTicks = 0;
  }

  /** Чей вид получает место: наблюдаемого игрока или свой. */
  private viewOf(seat: Seat): number {
    return seat.watching ?? seat.playerId;
  }

  /**
   * Выбывший игрок переключает наблюдение на другого игрока (или назад на себя). Живому отказ:
   * вид соперника с его туманом — чужая информация. Следующий вид уходит полным снимком.
   */
  public watch(conn: Connection, player: number): void {
    const seat = this.seatOf(conn);
    const state = this.state;
    if (seat === undefined || state === null || this.phase !== 'running') return;
    if (!seat.spectator && state.players[seat.playerId]?.status === 'alive') return;
    if (state.players[player] === undefined) return;
    seat.watching = !seat.spectator && player === seat.playerId ? null : player;
    seat.stream.reset();
    seat.waitingTicks = 0;
    seat.events = [];
    seat.selected = null;
    seat.lastSel = null;
    this.send(seat, { t: 'selection', sel: null });
  }

  /** Игрок выбрал гекс: карточка придёт сразу и затем при каждом изменении. */
  public select(conn: Connection, hex: number | null): void {
    const seat = this.seatOf(conn);
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
    const seat = this.seatOf(conn);
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
        preview: previewPath(state, this.viewOf(seat), q.unitIds, q.to, q.via),
      });
      return;
    }
    const mask =
      q.mode === 'supply'
        ? supplyLevels(state, this.viewOf(seat))
        : buildMask(state, this.viewOf(seat), q.mode.slice('build:'.length) as BuildMaskKind);
    this.send(seat, { t: 'mapMask', id, mode: q.mode, rle: encodeMaskRle(mask) });
  }

  /** Карточка гекса уходит, если гекс виден игроку и карточка изменилась с прошлой отправки. */
  private pushSelection(seat: Seat, state: MatchState): void {
    if (seat.conn === null) return;
    const hex = seat.selected;
    const viewer = this.viewOf(seat);
    const visible = hex !== null && (!state.fog || state.vision?.visible[viewer]?.[hex] === 1);
    const sel = hex !== null && visible ? selectionFor(state, viewer, hex) : null;
    const json = JSON.stringify(sel);
    if (json === seat.lastSel) return;
    seat.lastSel = json;
    this.send(seat, { t: 'selection', sel });
  }

  /** Клиент потерял базу: следующим уйдёт полный снимок. */
  public resync(conn: Connection): void {
    const seat = this.seatOf(conn);
    if (seat === undefined) return;
    seat.stream.reset();
    seat.waitingTicks = 0;
  }

  /** Готовность к старту: видна всем в списке мест. */
  public setReady(conn: Connection, ready: boolean): void {
    const seat = this.seatOf(conn);
    if (this.phase !== 'lobby' || seat === undefined || seat.spectator) return;
    seat.ready = ready;
    this.broadcastLobby();
  }

  /**
   * Хозяин передаёт комнату: выбранный человек встаёт на первое место (хозяин — всегда первое), места
   * перенумеровываются, все получают новое приветствие и табло.
   */
  public transfer(conn: Connection, to: number): void {
    if (this.phase !== 'lobby' || this.mode !== 'private' || this.seats[0]?.conn !== conn) return;
    const target = this.seats.find((seat) => seat.playerId === to);
    if (target === undefined || target === this.seats[0]) return;
    this.seats.splice(this.seats.indexOf(target), 1);
    this.seats.unshift(target);
    this.seats.forEach((seat, index) => {
      seat.playerId = index;
    });
    for (const seat of this.seats) if (seat.conn !== null) this.sendWelcome(seat);
    this.broadcastLobby();
  }

  /** Стартовая точка человека: занятая другим игроком не выдаётся; `null` — случайная. */
  public pick(conn: Connection, spawn: number | null): void {
    const seat = this.seatOf(conn);
    if (this.phase !== 'lobby' || seat === undefined || seat.spectator) return;
    if (spawn !== null) {
      if (spawn >= this.map.spawns.length) return;
      if (this.seats.some((other) => other !== seat && other.spawn === spawn)) return;
    }
    seat.spawn = spawn;
    this.broadcastLobby();
  }

  /** Можно ли после матча вернуть присутствующих в лобби (закрытая комната, есть люди онлайн). */
  public get rematchable(): boolean {
    return this.phase === 'ended' && this.mode === 'private' && this.hasConnected();
  }

  /**
   * «Ещё раз»: любой присутствующий возвращает всех присутствующих в лобби этой комнаты. Ушедшие и зрители
   * отпадают, зерно случайной карты меняется, готовность и выбор точек сбрасываются.
   */
  public rematch(conn: Connection): void {
    if (!this.rematchable) return;
    if (!this.seats.some((seat) => seat.conn === conn)) return;
    for (const spectator of this.spectators.splice(0)) spectator.conn?.close();
    const kept = this.seats.filter((seat) => seat.conn !== null);
    this.seats.splice(0, this.seats.length, ...kept);
    this.seats.forEach((seat, index) => {
      Object.assign(seat, {
        playerId: index,
        pending: [],
        events: [],
        selected: null,
        lastSel: null,
        lastSeq: 0,
        waitingTicks: 0,
        droppedAt: null,
        botControlled: false,
        watching: null,
        ready: false,
        spawn: null,
      });
      seat.stream.reset();
    });
    this.state = null;
    this.phase = 'lobby';
    // Случайная карта после матча — новая: клиенты строят её по новому зерну сами.
    if (this.mapName === 'gen') {
      this.seed = Math.floor(Math.random() * REMATCH_SEED_RANGE);
      this.map = this.options.makeMap?.(this.seed, this.genSpawns) ?? this.map;
    }
    for (const seat of this.seats) {
      this.send(seat, { t: 'rematch' });
      this.sendWelcome(seat);
    }
    this.broadcastLobby();
  }

  /** Сообщение чата: всем в комнате или личное; не чаще четырёх за четыре секунды. */
  public chat(conn: Connection, message: { text?: string; emoji?: number; to?: number }): void {
    const from = this.seats.find((seat) => seat.conn === conn);
    if (from === undefined) return;
    const now = this.options.now();
    from.chatAt = from.chatAt.filter((at) => now - at < CHAT_WINDOW_MS);
    if (from.chatAt.length >= CHAT_BURST) return;
    from.chatAt.push(now);
    const out: S2C = {
      t: 'chat',
      from: from.playerId,
      nick: from.nick,
      ...(message.text === undefined ? {} : { text: message.text }),
      ...(message.emoji === undefined ? {} : { emoji: message.emoji }),
      ...(message.to === undefined ? {} : { to: message.to }),
    };
    const targets =
      message.to === undefined
        ? this.seats
        : this.seats.filter((seat) => seat === from || seat.playerId === message.to);
    for (const seat of targets) this.send(seat, out);
  }

  /** Метка на карте: видят сам игрок и его союзники (дипломатия матча). */
  public mark(conn: Connection, hex: number, kind: MarkKind): void {
    const state = this.state;
    const from = this.seats.find((seat) => seat.conn === conn);
    if (this.phase !== 'running' || state === null || from === undefined) return;
    if (hex >= state.hexes.owner.length) return;
    const now = this.options.now();
    from.chatAt = from.chatAt.filter((at) => now - at < CHAT_WINDOW_MS);
    if (from.chatAt.length >= CHAT_BURST) return;
    from.chatAt.push(now);
    for (const seat of this.seats) {
      if (seat !== from && !isAllied(state, from.playerId, seat.playerId)) continue;
      this.send(seat, { t: 'mark', from: from.playerId, hex, kind });
    }
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
    const { fog } = this.options;
    const { size } = this;
    const { map, seed } = this;
    const setup = Array.from({ length: size }, (_, i) => {
      const seat = this.seats[i];
      return {
        name: seat?.nick ?? `Бот ${i - this.seats.length + 1}`,
        ...(seat?.spawn === null || seat === undefined ? {} : { spawn: seat.spawn }),
      };
    });
    const state = createMatch(map, setup, seed, { fog, diplomacy: true });
    for (const seat of this.seats) {
      this.takeBack(seat, state);
      this.sendStartArmy(seat, state);
    }
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
    const levels = state.players.map(() => BOT_LEVELS[this.level]);
    const commands: PlayerCommand[] = [];
    for (const seat of this.seats) {
      if (seat.botControlled) continue;
      for (const cmd of seat.pending) commands.push({ playerId: seat.playerId, cmd });
      seat.pending = [];
    }
    commands.push(...commanderCommands(state, botIds, levels, context));
    commands.push(...botCommands(state, botIds, levels, context));
    this.handOverDropped();
    const decided = performance.now();
    step(state, commands);
    const stepped = performance.now();
    this.stats.stepMs += stepped - started;
    this.stats.ticks += 1;
    this.sendViews(state);
    const done = performance.now();
    this.stats.viewMs += done - stepped;
    this.stats.last = {
      botsMs: decided - started,
      stepMs: stepped - decided,
      viewMs: done - stepped,
    };
    // Сглаженная цена тика комнаты (≈ 5 с памяти): по ней хаб решает, пускать ли новые комнаты.
    const total = done - started;
    this.costMs = this.costMs === 0 ? total : this.costMs * 0.98 + total * 0.02;
    if (state.winner >= 0) this.finish(state);
  }

  /** Закрывает соединения и помечает комнату завершённой. */
  public close(): void {
    this.phase = 'ended';
    for (const seat of [...this.seats, ...this.spectators]) seat.conn?.close();
  }

  private botIds(): number[] {
    const humans = new Set(this.seats.filter((s) => !s.botControlled).map((s) => s.playerId));
    const ids: number[] = [];
    for (let id = 0; id < this.size; id += 1) if (!humans.has(id)) ids.push(id);
    return ids;
  }

  /**
   * Стартовые отряды человека сразу занимают ничью землю — как в локальном матче: армия не стоит без
   * дела, пока игрок не откроет меню, и сразу видна в окне занятия.
   */
  private sendStartArmy(seat: Seat, state: MatchState): void {
    let soldiers = 0;
    for (const unit of state.units) if (unit.owner === seat.playerId) soldiers += unit.soldiers;
    if (soldiers <= 0) return;
    seat.pending.push({
      t: 'launchOffensive',
      target: -1,
      soldiers: intDiv(soldiers + FP - 1, FP),
    });
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
    this.snapshotsThisTick = 0;
    for (const seat of this.seats) {
      if (seat.botControlled) continue;
      this.sendSeatView(seat, state, context);
    }
    this.dropStaleSpectators();
    for (const seat of this.spectators) this.sendSeatView(seat, state, context);
  }

  /** Зритель без связи дольше SPECTATOR_KEEP_SECONDS освобождает место. */
  private dropStaleSpectators(): void {
    const now = this.options.now();
    for (let i = this.spectators.length - 1; i >= 0; i -= 1) {
      const seat = this.spectators[i];
      if (seat?.droppedAt != null && now - seat.droppedAt >= SPECTATOR_KEEP_SECONDS * 1000) {
        this.spectators.splice(i, 1);
      }
    }
  }

  private sendSeatView(
    seat: Seat,
    state: MatchState,
    context: ReturnType<typeof createPlayerViewContext>,
  ): void {
    seat.events.push(...eventsFor(state.events, this.viewOf(seat)));
    if (seat.events.length > MAX_QUEUED_EVENTS)
      seat.events.splice(0, seat.events.length - MAX_QUEUED_EVENTS);
    if (seat.conn === null) return;
    if (seat.stream.isWaiting) {
      seat.waitingTicks += 1;
      if (seat.waitingTicks < ACK_STALE_TICKS) return;
      // Подтверждение потерялось: начинаем с полного снимка.
      seat.stream.reset();
      seat.waitingTicks = 0;
      seat.events = [];
    }
    if (seat.stream.willSendSnapshot && this.snapshotsThisTick >= MAX_SNAPSHOTS_PER_TICK) return;
    if (seat.selected !== null || seat.lastSel !== null) this.pushSelection(seat, state);
    const reuse = slowLayerReuse(seat.stream.baseView, seat.stream.isSlowSync(state.tick));
    const view = playerView(state, this.viewOf(seat), context, reuse);
    const transport = seat.stream.next(view, seat.events);
    if (transport === null) return;
    if (transport.kind === 'snapshot') this.snapshotsThisTick += 1;
    seat.events = [];
    const text =
      transport.kind === 'snapshot'
        ? encodeSnapshot(transport.snapshot)
        : encodeDelta(transport.delta);
    this.sendText(seat, text);
  }

  private finish(state: MatchState): void {
    this.phase = 'ended';
    for (const seat of [...this.seats, ...this.spectators]) {
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
      map: this.mapName,
      seed: this.seed,
      players: this.size,
      genSpawns: this.genSpawns,
      fog: this.options.fog,
      ...(seat.spectator ? { spectator: true } : {}),
    });
  }

  private broadcastLobby(): void {
    const info = this.lobbyInfo();
    this.seats.forEach((seat, index) => {
      this.send(seat, { t: 'lobby', info, host: index === 0 });
    });
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
