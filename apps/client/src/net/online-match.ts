// Онлайн-матч для экрана игры: тот же интерфейс `LocalMatch`, что у воркера, но вид приходит по сети.
// Расчёты, которым нужно полное состояние (карточка гекса, прогноз пути, маски карты), делает сервер.
import {
  decodeMaskRle,
  type DeltaMessage,
  type MapMaskMode,
  type SnapshotMessage,
} from '@hexfront/protocol';
import type { Selection } from '@hexfront/sim';

import { chatStore } from './chat-store.ts';
import {
  NetClient,
  realClock,
  type NetClock,
  type NetSocket,
  type NetStatus,
} from './net-client.ts';
import type { LocalMatch } from '../local/match-api.ts';
import type { FromWorker } from '../local/messages.ts';
import { placement } from '../match/placement.ts';

export interface OnlineMatch extends LocalMatch {
  readonly client: NetClient;
}

export interface OnlineOptions {
  readonly connect: () => NetSocket;
  readonly token: string;
  readonly nick: string;
  /** Число гексов карты: для разворота масок. */
  readonly mapSize: number;
  readonly onMessage: (message: FromWorker) => void;
  readonly onStatus?: (status: NetStatus) => void;
  /** Закрытая комната: после матча доступно «Ещё раз». */
  readonly friends?: boolean;
  /** Хозяин вернул всех в лобби: экран матча уходит в лобби. */
  readonly onRematch?: () => void;
  readonly clock?: NetClock;
}

/** Подключается к уже созданной сессии (токен из лобби) и отдаёт экрану игры сообщения воркера. */
export function startOnlineMatch(options: OnlineOptions): OnlineMatch {
  let seq = 0;
  let selection: Selection | null = null;
  const ticks = new Map<number, number>();

  const rejectedOf = (message: DeltaMessage): { command: string; reason: never }[] =>
    message.d.events.flatMap((event) =>
      event.t === 'commandRejected' && !event.auto
        ? [{ command: event.command, reason: event.reason as never }]
        : [],
    );

  const client = new NetClient({
    connect: options.connect,
    clock: options.clock ?? realClock,
    nick: options.nick,
    token: options.token,
    external: true,
    handlers: {
      onSnapshot: (message: SnapshotMessage) => {
        seq += 1;
        ticks.set(seq, message.tick);
        options.onMessage({
          t: 'view',
          seq,
          view: message.view,
          kind: 'snapshot',
          snapshot: message,
          selection,
          rejected: [],
          events: [],
        });
      },
      onDelta: (message) => {
        seq += 1;
        ticks.set(seq, message.tick);
        options.onMessage({
          t: 'view',
          seq,
          // Как в воркере: у дельты вида нет, экран применяет её сам.
          view: undefined as never,
          kind: 'delta',
          delta: message,
          selection,
          rejected: rejectedOf(message),
          events: message.d.events,
        });
      },
      onSession: (session) => {
        const current = chatStore.getState().sender;
        if (current?.me === session.playerId || session.spectator) return;
        chatStore.setSender({
          me: session.playerId,
          chat: (message) => client.chat(message),
          mark: (hex, kind) => client.mark(hex, kind),
          ...(options.friends === true ? { rematch: () => client.rematch() } : {}),
        });
      },
      onChat: (message) => chatStore.receive(message),
      onHumans: (ids) => chatStore.setHumans(ids),
      onPlacing: (endsInS, spawn, decided) => {
        const endsAt = performance.now() + endsInS * 1000;
        if (placement.getState().active) placement.update({ endsAt, spawn, decided });
        else {
          placement.begin(endsAt, { choose: (picked) => client.pick(picked) });
          placement.update({ spawn, decided });
        }
      },
      onMark: (from, hex, kind) => chatStore.receiveMark({ from, hex, kind }),
      onRematch: () => options.onRematch?.(),
      onSelection: (sel) => {
        selection = sel;
      },
      onPath: (id, preview) => {
        options.onMessage({ t: 'pathPreview', requestId: id, preview });
      },
      onMask: (id, mode: MapMaskMode, rle) => {
        options.onMessage({
          t: 'mapMask',
          requestId: id,
          mode,
          mask: decodeMaskRle(rle, options.mapSize),
        });
      },
      onRefused: (reason) => {
        options.onMessage({ t: 'error', errors: [`refused:${reason}`] });
      },
      ...(options.onStatus ? { onStatus: options.onStatus } : {}),
    },
  });
  client.start();

  const noop = (): void => undefined;
  // Чей вид сейчас запрошен; запрос повторять не нужно (экран зовёт setView при каждом старте).
  let watching: number | null = null;
  const watch = (playerId: number | null): void => {
    if (playerId === watching) return;
    watching = playerId;
    const target = playerId ?? client.session?.playerId;
    if (target !== undefined) client.watch(target);
  };
  return {
    client,
    send: (cmd) => {
      client.command(cmd);
    },
    // Туман, наблюдатель, пауза и скорость в сетевом матче принадлежат серверу.
    setFog: noop,
    setPaused: noop,
    step: noop,
    setSpeed: noop,
    // Выбывший смотрит чужими глазами: `null` — вернуться к себе. Живому сервер не ответит.
    setObserver: (playerId) => {
      watch(playerId);
    },
    setView: (playerId) => {
      watch(playerId);
    },
    select: (hex) => {
      client.select(hex);
    },
    previewPath: (requestId, unitIds, to, via) => {
      client.query(requestId, { kind: 'path', unitIds, to, via });
    },
    requestMask: (requestId, mode) => {
      client.query(requestId, { kind: 'mask', mode });
    },
    ack: (viewSeq) => {
      const tick = ticks.get(viewSeq);
      ticks.delete(viewSeq);
      if (tick !== undefined) client.ack(tick);
    },
    resync: () => {
      client.resync();
    },
    dispose: () => {
      chatStore.setSender(null);
      client.stop();
    },
  };
}
