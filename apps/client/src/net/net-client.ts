// Сетевой клиент матча: соединение, реконнект с возобновлением, повтор команд, пульс и RTT.
// Не зависит от браузера: сокет и часы приходят снаружи (тесты гоняют его на виртуальном времени).
//
// Защита от потерь и плохой связи:
//  * команды нумеруются и хранятся, пока сервер не подтвердит `ack`; после обрыва уходят заново,
//    сервер повтор не исполняет (идемпотентность по `seq`);
//  * при реконнекте клиент называет тик последнего применённого вида (`have`): сервер продолжает
//    дельтами, а не шлёт полный снимок;
//  * ошибка применения дельты или разрыв базы — `resync` (полный снимок), без перезапуска матча;
//  * мёртвое соединение (нет входящих дольше DEAD_AFTER_MS) обрывается самим клиентом, не дожидаясь TCP.
import {
  decodeDelta,
  decodeSnapshot,
  encodeClientMessage,
  PROTOCOL_VERSION,
  ProtocolError,
  type C2S,
  type DeltaMessage,
  type JoinMode,
  type MapMaskMode,
  type Query,
  type SnapshotMessage,
  type LobbyInfo,
  type RefuseReason,
  type S2C,
} from '@hexfront/protocol';
import type { Command, GameEvent, PathPreview, PlayerView, Selection } from '@hexfront/sim';

import { ViewDeltaApplier } from '../local/view-delta.ts';

/** Сокет, каким его видит клиент: тонкая обёртка над WebSocket. */
export interface NetSocket {
  send(text: string): void;
  close(): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
}

export interface NetClock {
  now(): number;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'closed';

/** Сведения о сессии для сохранения (переживает перезагрузку страницы). */
export interface NetSession {
  readonly token: string;
  readonly room: string;
  readonly playerId: number;
  readonly map: string;
  readonly seed: number;
  readonly players: number;
  readonly fog: boolean;
}

export interface NetHandlers {
  onStatus?(status: NetStatus): void;
  onSession?(session: NetSession): void;
  onLobby?(info: LobbyInfo): void;
  onStart?(tick: number): void;
  /** Новый вид игрока и события тика; `full` — пришёл полный снимок. */
  onView?(view: PlayerView, events: readonly GameEvent[], full: boolean): void;
  /** Режим `external`: вид применяет потребитель и подтверждает `ack(tick)`; клиент только декодирует. */
  onSnapshot?(message: SnapshotMessage): void;
  onDelta?(message: DeltaMessage): void;
  onSelection?(sel: Selection | null): void;
  onPath?(id: number, preview: PathPreview | null): void;
  onMask?(id: number, mode: MapMaskMode, rle: readonly number[]): void;
  onRejected?(seq: number, reason: string): void;
  onRefused?(reason: RefuseReason): void;
  onEnd?(winner: number, tick: number): void;
}

export interface NetOptions {
  readonly connect: () => NetSocket;
  readonly clock: NetClock;
  readonly nick: string;
  readonly mode?: JoinMode;
  /** Код комнаты из приглашения. */
  readonly room?: string;
  /** Токен сохранённой сессии (после перезагрузки страницы). */
  readonly token?: string;
  readonly handlers?: NetHandlers;
  /**
   * Вид применяет и подтверждает потребитель (экран игры применяет в своём кадре): клиент отдаёт
   * `onSnapshot`/`onDelta`, а `viewAck` уходит по `ack(tick)`. Так база сервера — то, что реально применено.
   */
  readonly external?: boolean;
  /** Случайность для разброса повторов; в тестах подменяется. */
  readonly random?: () => number;
}

/** Период пинга: по нему считаем RTT и держим канал живым. */
export const PING_MS = 2000;
/** Нет входящих дольше этого — соединение мёртвое, переподключаемся. */
export const DEAD_AFTER_MS = 6000;
/** Задержка первого повтора соединения и потолок. */
export const RETRY_BASE_MS = 250;
export const RETRY_MAX_MS = 5000;
/** Сколько всего пытаемся вернуться, прежде чем сдаться (сервер держит место 30 с, затем бот). */
export const GIVE_UP_MS = 5 * 60_000;

/** Причины отказа, при которых повторять бессмысленно. */
const FINAL_REFUSALS: ReadonlySet<RefuseReason> = new Set([
  'versionMismatch',
  'badNick',
  'noRoom',
  'badHello',
  'roomFull',
]);

export class NetClient {
  public status: NetStatus = 'connecting';
  /** Сглаженный RTT, мс; `null`, пока не было ответа. */
  public rtt: number | null = null;
  public session: NetSession | null = null;

  private readonly options: NetOptions;
  private readonly clock: NetClock;
  private readonly random: () => number;
  private readonly applier: ViewDeltaApplier;
  private socket: NetSocket | null = null;
  private token: string | undefined;
  private attempt = 0;
  private lostAt: number | null = null;
  private lastRx = 0;
  private nextSeq = 1;
  private outbox: { seq: number; cmd: Command }[] = [];
  private tickHandle: unknown = null;
  private retryHandle: unknown = null;
  private stopped = false;
  private fullPending = true;
  /** Тик последнего применённого и подтверждённого вида: база для `have` при реконнекте. */
  private appliedTick: number | null = null;

  public constructor(options: NetOptions) {
    this.options = options;
    this.clock = options.clock;
    this.random = options.random ?? Math.random;
    this.token = options.token;
    // База дельты потеряна → просим полный снимок у сервера.
    this.applier = new ViewDeltaApplier(() => {
      this.fullPending = true;
      if (this.session !== null) this.send({ t: 'resync' });
    });
  }

  /** Последний применённый вид. */
  public get view(): PlayerView | null {
    return this.applier.view;
  }

  /** Подтверждает серверу, что вид этого тика применён (режим `external`). */
  public ack(tick: number): void {
    this.appliedTick = tick;
    this.send({ t: 'viewAck', tick });
  }

  /** База дельты потеряна на стороне потребителя: просим полный снимок. */
  public resync(): void {
    this.fullPending = true;
    this.appliedTick = null;
    this.send({ t: 'resync' });
  }

  /** Выбранный гекс: сервер пришлёт карточку. */
  public select(hex: number | null): void {
    this.send({ t: 'select', hex });
  }

  /** Запрос к серверу по полному состоянию (путь, маска карты). */
  public query(id: number, q: Query): void {
    this.send({ t: 'query', id, q });
  }

  /** Команд, ещё не подтверждённых сервером. */
  public get unacked(): number {
    return this.outbox.length;
  }

  /** Начинает соединение. */
  public start(): void {
    this.stopped = false;
    this.open();
  }

  /** Закрывает навсегда (выход из матча). */
  public stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }

  /**
   * Отправляет команду игрока. Хранится до подтверждения и переживает обрыв.
   * @returns номер команды в сессии
   */
  public command(cmd: Command): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.outbox.push({ seq, cmd });
    if (this.status === 'online') this.send({ t: 'cmd', seq, cmd });
    return seq;
  }

  /** Хозяин закрытой комнаты запускает матч. */
  public startMatch(): void {
    this.send({ t: 'start' });
  }

  private open(): void {
    this.clearTimers();
    this.lastRx = this.clock.now();
    this.setStatus(this.attempt === 0 && this.session === null ? 'connecting' : 'reconnecting');
    const socket = this.options.connect();
    this.socket = socket;
    socket.onOpen(() => {
      if (this.socket !== socket) return;
      this.lastRx = this.clock.now();
      this.hello();
    });
    socket.onMessage((text) => {
      if (this.socket !== socket) return;
      this.lastRx = this.clock.now();
      this.receive(text);
    });
    socket.onClose(() => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.lost();
    });
    this.schedulePulse();
  }

  private hello(): void {
    this.send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      nick: this.options.nick,
      ...(this.token === undefined ? {} : { token: this.token }),
      ...(this.options.room !== undefined && this.token === undefined
        ? { room: this.options.room }
        : {}),
      ...(this.options.mode !== undefined && this.token === undefined
        ? { mode: this.options.mode }
        : {}),
      // Базу называем только если уверены, что она применена и не просит замены.
      ...(this.appliedTick !== null && !this.fullPending ? { have: this.appliedTick } : {}),
    });
  }

  private receive(text: string): void {
    try {
      if (text.startsWith('{"t":"delta"')) this.onDelta(text);
      else if (text.startsWith('{"t":"snapshot"')) this.onSnapshot(text);
      else this.onControl(JSON.parse(text) as S2C);
    } catch (error) {
      if (!(error instanceof ProtocolError || error instanceof SyntaxError)) throw error;
      // Испорченное или несогласованное сообщение: просим полный снимок и идём дальше.
      if (this.options.external === true) this.resync();
      else this.applier.requestViewChange();
    }
  }

  private onSnapshot(text: string): void {
    const message = decodeSnapshot(text);
    if (this.options.external === true) {
      this.fullPending = false;
      this.options.handlers?.onSnapshot?.(message);
      return;
    }
    const view = this.applier.applySnapshot(message);
    this.fullPending = false;
    this.appliedTick = message.tick;
    this.send({ t: 'viewAck', tick: message.tick });
    this.deliver(view, [], true);
  }

  private onDelta(text: string): void {
    const message = decodeDelta(text);
    if (this.fullPending) return;
    if (this.options.external === true) {
      this.options.handlers?.onDelta?.(message);
      return;
    }
    const before = this.applier.view?.tick ?? -1;
    const view = this.applier.applyDelta(message);
    this.appliedTick = message.tick;
    this.send({ t: 'viewAck', tick: message.tick });
    if (view.tick === before) return;
    // События берём из самого сообщения: накопитель applier растёт весь матч.
    this.deliver(view, message.d.events, false);
  }

  private deliver(view: PlayerView, events: readonly GameEvent[], full: boolean): void {
    this.options.handlers?.onView?.(view, events, full);
  }

  private onControl(message: S2C): void {
    const handlers = this.options.handlers;
    switch (message.t) {
      case 'welcome': {
        this.token = message.token;
        this.session = {
          token: message.token,
          room: message.room,
          playerId: message.playerId,
          map: message.map,
          seed: message.seed,
          players: message.players,
          fog: message.fog,
        };
        this.attempt = 0;
        this.lostAt = null;
        this.setStatus('online');
        handlers?.onSession?.(this.session);
        // Всё, что сервер не успел подтвердить, уходит заново в том же порядке.
        for (const item of this.outbox) this.send({ t: 'cmd', seq: item.seq, cmd: item.cmd });
        return;
      }
      case 'lobby':
        handlers?.onLobby?.(message.info);
        return;
      case 'start':
        handlers?.onStart?.(message.tick);
        return;
      case 'ack':
        this.outbox = this.outbox.filter((item) => item.seq > message.seq);
        return;
      case 'rejected':
        this.outbox = this.outbox.filter((item) => item.seq !== message.seq);
        handlers?.onRejected?.(message.seq, message.reason);
        return;
      case 'refused':
        handlers?.onRefused?.(message.reason);
        if (FINAL_REFUSALS.has(message.reason)) this.stop();
        return;
      case 'selection':
        handlers?.onSelection?.(message.sel);
        return;
      case 'pathPreview':
        handlers?.onPath?.(message.id, message.preview);
        return;
      case 'mapMask':
        handlers?.onMask?.(message.id, message.mode, message.rle);
        return;
      case 'end':
        handlers?.onEnd?.(message.winner, message.tick);
        return;
      case 'pong': {
        const sample = this.clock.now() - message.at;
        this.rtt = this.rtt === null ? sample : this.rtt * 0.8 + sample * 0.2;
        return;
      }
    }
  }

  private send(message: C2S): void {
    this.socket?.send(encodeClientMessage(message));
  }

  /** Пульс: пинг для RTT и проверка, что сервер ещё отвечает. */
  private schedulePulse(): void {
    this.tickHandle = this.clock.setTimeout(() => {
      if (this.socket === null) return;
      if (this.clock.now() - this.lastRx > DEAD_AFTER_MS) {
        const dead = this.socket;
        this.socket = null;
        dead.close();
        this.lost();
        return;
      }
      if (this.status === 'online') this.send({ t: 'ping', at: this.clock.now() });
      this.schedulePulse();
    }, PING_MS);
  }

  private lost(): void {
    if (this.stopped) return;
    if (this.tickHandle !== null) this.clock.clearTimeout(this.tickHandle);
    this.tickHandle = null;
    this.lostAt ??= this.clock.now();
    this.setStatus('reconnecting');
    if (this.clock.now() - this.lostAt > GIVE_UP_MS) {
      this.stop();
      return;
    }
    // Экспоненциальная пауза с разбросом: массовый обрыв не превращается в волну повторов.
    const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempt);
    this.attempt += 1;
    const delay = Math.round(base * (0.5 + this.random() * 0.5));
    this.retryHandle = this.clock.setTimeout(() => {
      this.retryHandle = null;
      this.open();
    }, delay);
  }

  private setStatus(status: NetStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.handlers?.onStatus?.(status);
  }

  private clearTimers(): void {
    if (this.tickHandle !== null) this.clock.clearTimeout(this.tickHandle);
    if (this.retryHandle !== null) this.clock.clearTimeout(this.retryHandle);
    this.tickHandle = null;
    this.retryHandle = null;
  }
}

/** Часы браузера и Node. */
export const realClock: NetClock = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** Сокет поверх `WebSocket` браузера. */
export function webSocketTransport(url: string): () => NetSocket {
  return () => {
    const ws = new WebSocket(url);
    return {
      send: (text) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
      },
      close: () => {
        ws.close();
      },
      onOpen: (handler) => {
        ws.addEventListener('open', handler);
      },
      onMessage: (handler) => {
        ws.addEventListener('message', (event) => {
          if (typeof event.data === 'string') handler(event.data);
        });
      },
      onClose: (handler) => {
        ws.addEventListener('close', handler);
        ws.addEventListener('error', handler);
      },
    };
  };
}
