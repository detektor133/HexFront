// Сообщения клиент ↔ сервер (docs/architecture/protocol.md). Снимок и дельта кодируются в index.ts.
// Входящее от клиента проверяется вручную и считается недоверенным: форма, типы, длины, лимиты.
import type { Command, PathPreview, RejectReason, Selection } from '@hexfront/sim';

/** Число стартовых точек случайной карты: малая, средняя (по умолчанию), большая. */
export const GEN_SPAWNS = [12, 30, 60] as const;
export const GEN_SPAWNS_DEFAULT = 30;

/** Режим карты: снабжение или стройка (build:city, build:fort, build:depot, build:improve). */
export type MapMaskMode = 'supply' | 'build:city' | 'build:fort' | 'build:depot' | 'build:improve';
export const MAP_MASK_MODES: readonly MapMaskMode[] = [
  'supply',
  'build:city',
  'build:fort',
  'build:depot',
  'build:improve',
];

/** Запрос к серверу, на который нужно полное состояние матча (у клиента сети его нет). */
export type Query =
  | {
      readonly kind: 'path';
      readonly unitIds: readonly number[];
      readonly to: number;
      readonly via: readonly number[];
    }
  | { readonly kind: 'mask'; readonly mode: MapMaskMode };

/** Запросов в секунду от одного игрока (прогноз пути при протяжке, маски карты). */
export const MAX_QUERIES_PER_SECOND = 30;

/** Версия протокола: несовпадение — `versionMismatch` и закрытие соединения. */
export const PROTOCOL_VERSION = 1;

/** Предел размера входящего сообщения, байт (после него соединение закрывается). */
export const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;
/** Команд в секунду от одного игрока; больше — отклоняются с `rateLimit`. */
export const MAX_COMMANDS_PER_SECOND = 20;
export const NICK_MIN = 2;
export const NICK_MAX = 20;
const TOKEN_MAX = 64;
const STRING_MAX = 40;
const ARRAY_MAX = 512;
const LINES_MAX = 16;

/** Режим входа в матч (docs/stages/stage-09-analysis.md, «Играть онлайн» и «Пригласить друзей»). */
export type JoinMode = 'open' | 'private';

/** Сложность ботов комнаты (как в меню «Против ботов»): `hard` — самый сильный профиль. */
export type LobbyLevel = 'easy' | 'normal' | 'hard';
export const LOBBY_LEVELS: readonly LobbyLevel[] = ['easy', 'normal', 'hard'];

/** Карты закрытой комнаты, как в меню «Против ботов»; число игроков выбирается на картах из LOBBY_PLAYER_MAPS. */
export type LobbyMap =
  | 'gen'
  | 'europe'
  | 'small'
  | 'tiny'
  | 'mediterranean'
  | 'north'
  | 'namerica'
  | 'japan'
  | 'mideast'
  | 'continent'
  | 'archipelago';
export const LOBBY_MAPS: readonly LobbyMap[] = [
  'europe',
  'gen',
  'small',
  'tiny',
  'mediterranean',
  'north',
  'namerica',
  'japan',
  'mideast',
  'continent',
  'archipelago',
];
/** Готовые карты с выбором числа игроков (до числа спавнов карты). */
export const LOBBY_PLAYER_MAPS: readonly LobbyMap[] = [
  'europe',
  'mediterranean',
  'north',
  'namerica',
  'japan',
  'mideast',
  'continent',
  'archipelago',
];

/** Предельная длина сообщения чата. */
export const CHAT_MAX = 140;
/** Номеров быстрых эмодзи в наборе клиента. */
export const EMOJI_COUNT = 8;

/** Вид метки на карте: атака, защита, помощь, внимание. */
export type MarkKind = 'attack' | 'defend' | 'help' | 'look';
export const MARK_KINDS: readonly MarkKind[] = ['attack', 'defend', 'help', 'look'];

export type C2S =
  | {
      readonly t: 'hello';
      readonly v: number;
      readonly nick: string;
      /** Токен прежней сессии для реконнекта. */
      readonly token?: string;
      /** Код комнаты из приглашения; нет поля — открытая комната. */
      readonly room?: string;
      /** `private` создаёт закрытую комнату для друзей. */
      readonly mode?: JoinMode;
      /**
       * Тик последнего применённого вида при реконнекте: если сервер помнит эту базу, он продолжит
       * дельтами, а не полным снимком (восстановление после обрыва при слабой связи).
       */
      readonly have?: number;
      /** Смотреть идущий матч комнаты `room` без участия: вид игрока, приказов нет. */
      readonly spectate?: boolean;
    }
  /**
   * Команда с номером `seq`, подряд идущим в рамках сессии. Сервер принимает только следующий по
   * порядку номер: повтор (после обрыва) он не исполняет второй раз, а подтверждает (`ack`
   * накопительный), пропуск и превышение лимита не принимает и просит повторить (`retry`, `rateLimit`).
   */
  | { readonly t: 'cmd'; readonly seq: number; readonly cmd: Command }
  /** Клиент потерял базу дельты (ошибка применения): сервер шлёт полный снимок. */
  | { readonly t: 'resync' }
  | { readonly t: 'viewAck'; readonly tick: number }
  | { readonly t: 'ping'; readonly at: number }
  /** Выбранный гекс: сервер присылает карточку (`selection`) сразу и при каждом её изменении. */
  | { readonly t: 'select'; readonly hex: number | null }
  /** Расчёт по полному состоянию; ответ приходит с тем же `id`. */
  | { readonly t: 'query'; readonly id: number; readonly q: Query }
  /** Хозяин закрытой комнаты запускает матч раньше срока (остальные места займут боты). */
  | { readonly t: 'start' }
  /**
   * Хозяин закрытой комнаты правит игру до старта: сложность ботов, карту и (на `europe`) число
   * игроков. Остальным сервер не отвечает.
   */
  | {
      readonly t: 'configure';
      readonly level?: LobbyLevel;
      readonly map?: LobbyMap;
      readonly players?: number;
      /** Новое зерно случайной карты (кнопка «Сгенерировать»). */
      readonly seed?: number;
      /** Размер случайной карты: число стартовых точек из GEN_SPAWNS. */
      readonly genSpawns?: number;
    }
  /** Готовность к старту (закрытая комната): видна всем в списке мест. */
  | { readonly t: 'ready'; readonly ready: boolean }
  /** Хозяин передаёт комнату другому человеку из лобби (по номеру места `to`). */
  | { readonly t: 'transfer'; readonly to: number }
  /** Стартовая точка человека (индекс в карте);  — случайная. Только в лобби. */
  | { readonly t: 'pick'; readonly spawn: number | null }
  /** После матча хозяин возвращает всех присутствующих в лобби той же комнаты. */
  | { readonly t: 'rematch' }
  /**
   * Сообщение игрокам: текст или быстрый эмодзи (`emoji` — номер в наборе клиента). `to` — id
   * получателя (личное), нет поля — всем в комнате.
   */
  | {
      readonly t: 'chat';
      readonly text?: string;
      readonly emoji?: number;
      readonly to?: number;
    }
  /** Метка на карте для союзников (и себя): гекс и вид. */
  | { readonly t: 'mark'; readonly hex: number; readonly kind: MarkKind }
  /**
   * Выбывший игрок смотрит матч глазами другого игрока (вид, карточки, прогнозы — его), но не
   * командует. Живому игроку сервер отказывает молча: иначе можно подсматривать чужой туман.
   */
  | { readonly t: 'watch'; readonly player: number };

/** Причины, по которым сервер закрывает вход. */
export type RefuseReason =
  | 'versionMismatch'
  | 'badNick'
  | 'roomFull'
  | 'noRoom'
  | 'badHello'
  /** Сервер перегружен (лимит комнат) или слишком много входов с адреса. */
  | 'busy'
  /** Смотреть можно только идущий матч. */
  | 'notRunning';

export interface LobbyInfo {
  readonly room: string;
  readonly humans: number;
  readonly max: number;
  /** Секунд до старта сбора; `null` — ждём хозяина. */
  readonly startsInS: number | null;
  readonly open: boolean;
  /** Сложность ботов и карта комнаты: хозяин закрытой комнаты их меняет. */
  readonly level: LobbyLevel;
  readonly map: LobbyMap;
  /** Места людей по порядку: ник, готовность, владелец комнаты, выбранная стартовая точка. */
  readonly seats: readonly LobbySeat[];
  /** Столицы всех игроков комнаты (id гекса): сначала люди, затем боты; на карте их видят все. */
  readonly starts: readonly number[];
}

export interface LobbySeat {
  readonly id: number;
  readonly nick: string;
  readonly ready: boolean;
  readonly host: boolean;
  readonly spawn: number | null;
}

export type S2C =
  | {
      readonly t: 'welcome';
      readonly playerId: number;
      readonly token: string;
      readonly room: string;
      readonly tickMs: number;
      /** Карта, сид и число игроков: клиент собирает статические данные локально. */
      readonly map: string;
      readonly seed: number;
      readonly players: number;
      /** Стартовых точек случайной карты (на других картах не используется). */
      readonly genSpawns?: number;
      readonly fog: boolean;
      /** Место зрителя: `playerId` — игрок, чьими глазами идёт просмотр на старте. */
      readonly spectator?: boolean;
    }
  /** `host` — получатель хозяин комнаты (может начать матч раньше срока). */
  | { readonly t: 'lobby'; readonly info: LobbyInfo; readonly host: boolean }
  /**
   * Перед матчем игроки выбирают место старта на карте: `endsInS` секунд, `spawn` — точка, которую
   * сервер закрепил за получателем (ближайшая свободная к выбранной), `decided` — он уже выбрал.
   */
  | {
      readonly t: 'placing';
      readonly endsInS: number;
      readonly spawn: number | null;
      readonly decided: boolean;
    }
  /** Номера игроков-людей (остальные — боты): писать и ставить метки имеет смысл только им. */
  | { readonly t: 'humans'; readonly ids: readonly number[] }
  | { readonly t: 'start'; readonly tick: number }
  | { readonly t: 'ack'; readonly seq: number }
  | {
      readonly t: 'rejected';
      readonly seq: number;
      /**
       * `rateLimit` и `retry` — команда не принята и не потеряна: клиент пришлёт её заново по порядку;
       * остальное — окончательный отказ.
       */
      readonly reason: RejectReason | 'rateLimit' | 'retry' | 'bad';
    }
  | { readonly t: 'refused'; readonly reason: RefuseReason }
  | { readonly t: 'end'; readonly winner: number; readonly tick: number }
  | { readonly t: 'pong'; readonly at: number }
  /** Сообщение чата: `from` — id отправителя, `to` есть у личных. */
  | {
      readonly t: 'chat';
      readonly from: number;
      readonly nick: string;
      readonly text?: string;
      readonly emoji?: number;
      readonly to?: number;
    }
  | { readonly t: 'mark'; readonly from: number; readonly hex: number; readonly kind: MarkKind }
  /** Матч закончился, хозяин вернул всех в лобби: клиент уходит с экрана матча в лобби. */
  | { readonly t: 'rematch' }
  /** Карточка выбранного гекса: приходит сразу при выборе и затем при каждом изменении. */
  | { readonly t: 'selection'; readonly sel: Selection | null }
  | { readonly t: 'pathPreview'; readonly id: number; readonly preview: PathPreview | null }
  /** Маска карты, сжатая подряд идущими повторами: [значение, сколько, значение, сколько, …]. */
  | {
      readonly t: 'mapMask';
      readonly id: number;
      readonly mode: MapMaskMode;
      readonly rle: number[];
    };

/** Ошибка разбора входящего сообщения; сервер закрывает соединение или отбрасывает сообщение. */
export class MessageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MessageError';
  }
}

/** Типы команд, которые клиент вправе слать; всё остальное отбрасывается до sim. */
export const CLIENT_COMMAND_TYPES: ReadonlySet<string> = new Set<Command['t']>([
  'setTax',
  'move',
  'attack',
  'assignFront',
  'setDefenseLine',
  'clearPlan',
  'setOffensiveLine',
  'startOffensive',
  'stopOffensive',
  'clearOffensive',
  'split',
  'merge',
  'stop',
  'gather',
  'bombard',
  'recruit',
  'foundCity',
  'upgradeCity',
  'improve',
  'build',
  'invade',
  'sail',
  'rebuildSupply',
  'createArmy',
  'setAutoReinforce',
  'setArmyAuto',
  'setAutoCommand',
  'declareWar',
  'proposeTreaty',
  'answerTreaty',
  'breakTreaty',
  'answerAid',
  'proposeExpel',
  'castVote',
  'launchOffensive',
  'holdBorder',
  'renameArmy',
  'renameCity',
  'disbandArmy',
  'dismissUnits',
  'splitArmy',
  'setArmyLimit',
  'assignUnits',
]);

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function intArray(value: unknown): boolean {
  return Array.isArray(value) && value.length <= ARRAY_MAX && value.every(isInt);
}

function fieldOk(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || isInt(value)) return true;
  if (typeof value === 'string') return value.length <= STRING_MAX;
  if (intArray(value)) return true;
  if (Array.isArray(value)) return value.length <= LINES_MAX && value.every(intArray);
  if (typeof value === 'object') {
    const mix = value as Record<string, unknown>;
    const keys = Object.keys(mix);
    return keys.length <= 2 && keys.every((key) => isInt(mix[key]));
  }
  return false;
}

/**
 * Проверяет форму команды от клиента: известный тип, только простые поля ограниченного размера.
 * Смысл команды (чей отряд, хватает ли золота) проверяет sim.
 * @returns та же команда либо `null`
 */
export function validateCommand(value: unknown): Command | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const cmd = value as Record<string, unknown>;
  if (typeof cmd.t !== 'string' || !CLIENT_COMMAND_TYPES.has(cmd.t)) return null;
  const keys = Object.keys(cmd);
  if (keys.length > 10) return null;
  for (const key of keys) {
    if (key === 'source' || key === '__proto__' || !fieldOk(cmd[key])) return null;
  }
  return cmd as unknown as Command;
}

function parseObject(text: string): Record<string, unknown> {
  if (text.length > MAX_CLIENT_MESSAGE_BYTES) throw new MessageError('Сообщение слишком большое');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new MessageError('Некорректный JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MessageError('Некорректное сообщение');
  }
  return value as Record<string, unknown>;
}

function decodeQuery(value: unknown): Query {
  if (typeof value !== 'object' || value === null) throw new MessageError('Некорректный запрос');
  const q = value as Record<string, unknown>;
  if (q.kind === 'mask') {
    const mode = MAP_MASK_MODES.find((item) => item === q.mode);
    if (mode === undefined) throw new MessageError('Некорректный режим карты');
    return { kind: 'mask', mode };
  }
  if (q.kind === 'path') {
    if (!isInt(q.to) || !intArray(q.unitIds) || !intArray(q.via)) {
      throw new MessageError('Некорректный запрос пути');
    }
    if ((q.via as number[]).length > LINES_MAX) throw new MessageError('Слишком много точек');
    return { kind: 'path', unitIds: q.unitIds as number[], to: q.to, via: q.via as number[] };
  }
  throw new MessageError('Неизвестный запрос');
}

/** Сжимает маску карты повторами значений: [значение, сколько, …]. */
export function encodeMaskRle(mask: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < mask.length) {
    const value = mask[i] ?? 0;
    let end = i + 1;
    while (end < mask.length && mask[end] === value) end += 1;
    out.push(value, end - i);
    i = end;
  }
  return out;
}

/** Разворачивает маску из повторов; `size` — число гексов карты (защита от чужого размера). */
export function decodeMaskRle(rle: readonly number[], size: number): Uint8Array {
  const mask = new Uint8Array(size);
  let at = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const value = rle[i] ?? 0;
    const count = Math.min(rle[i + 1] ?? 0, size - at);
    if (count <= 0) break;
    mask.fill(value, at, at + count);
    at += count;
  }
  return mask;
}

function haveTick(value: unknown): number {
  if (!isInt(value) || value < 0) throw new MessageError('Поле have');
  return value;
}

function optionalString(value: unknown, max: number, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new MessageError(`Поле ${name}`);
  return value;
}

/**
 * Разбирает сообщение клиента.
 * @throws MessageError если форма не подходит; сервер отбрасывает такое сообщение
 */
export function decodeClientMessage(text: string): C2S {
  const source = parseObject(text);
  switch (source.t) {
    case 'hello': {
      if (!isInt(source.v) || typeof source.nick !== 'string' || source.nick.length > 64) {
        throw new MessageError('Некорректный hello');
      }
      const token = optionalString(source.token, TOKEN_MAX, 'token');
      const room = optionalString(source.room, TOKEN_MAX, 'room');
      if (source.mode !== undefined && source.mode !== 'open' && source.mode !== 'private') {
        throw new MessageError('Поле mode');
      }
      return {
        t: 'hello',
        v: source.v,
        nick: source.nick,
        ...(token === undefined ? {} : { token }),
        ...(room === undefined ? {} : { room }),
        ...(source.mode === undefined ? {} : { mode: source.mode }),
        ...(source.have === undefined ? {} : { have: haveTick(source.have) }),
        ...(source.spectate === true ? { spectate: true } : {}),
      };
    }
    case 'cmd': {
      const cmd = validateCommand(source.cmd);
      if (!isInt(source.seq) || cmd === null) throw new MessageError('Некорректная команда');
      return { t: 'cmd', seq: source.seq, cmd };
    }
    case 'viewAck':
      if (!isInt(source.tick)) throw new MessageError('Некорректный viewAck');
      return { t: 'viewAck', tick: source.tick };
    case 'ping':
      if (!isInt(source.at)) throw new MessageError('Некорректный ping');
      return { t: 'ping', at: source.at };
    case 'start':
      return { t: 'start' };
    case 'configure': {
      const level = LOBBY_LEVELS.find((l) => l === source.level);
      if (source.level !== undefined && level === undefined) throw new MessageError('Поле level');
      const map = LOBBY_MAPS.find((m) => m === source.map);
      if (source.map !== undefined && map === undefined) throw new MessageError('Поле map');
      const seed = source.seed;
      if (seed !== undefined && (!isInt(seed) || seed < 0 || seed > 2_000_000_000)) {
        throw new MessageError('Поле seed');
      }
      const genSpawns = GEN_SPAWNS.find((n) => n === source.genSpawns);
      if (source.genSpawns !== undefined && genSpawns === undefined) {
        throw new MessageError('Поле genSpawns');
      }
      const players = source.players;
      if (players !== undefined && (!isInt(players) || players < 2 || players > 60)) {
        throw new MessageError('Поле players');
      }
      return {
        t: 'configure',
        ...(level === undefined ? {} : { level }),
        ...(map === undefined ? {} : { map }),
        ...(players === undefined ? {} : { players }),
        ...(seed === undefined ? {} : { seed }),
        ...(genSpawns === undefined ? {} : { genSpawns }),
      };
    }
    case 'ready':
      if (typeof source.ready !== 'boolean') throw new MessageError('Поле ready');
      return { t: 'ready', ready: source.ready };
    case 'transfer':
      if (!isInt(source.to) || source.to < 0 || source.to > 1000) {
        throw new MessageError('Поле to');
      }
      return { t: 'transfer', to: source.to };
    case 'pick':
      if (
        source.spawn !== null &&
        (!isInt(source.spawn) || source.spawn < 0 || source.spawn > 1_000_000)
      ) {
        throw new MessageError('Поле spawn');
      }
      return { t: 'pick', spawn: source.spawn };
    case 'rematch':
      return { t: 'rematch' };
    case 'chat': {
      const text = optionalString(source.text, CHAT_MAX, 'text');
      const { emoji, to } = source;
      if (emoji !== undefined && (!isInt(emoji) || emoji < 0 || emoji >= EMOJI_COUNT)) {
        throw new MessageError('Поле emoji');
      }
      if (to !== undefined && (!isInt(to) || to < 0 || to > 1000))
        throw new MessageError('Поле to');
      if ((text === undefined || text.trim() === '') && emoji === undefined) {
        throw new MessageError('Пустое сообщение');
      }
      return {
        t: 'chat',
        ...(text === undefined || text.trim() === '' ? {} : { text: text.trim() }),
        ...(emoji === undefined ? {} : { emoji }),
        ...(to === undefined ? {} : { to }),
      };
    }
    case 'mark': {
      const kind = MARK_KINDS.find((k) => k === source.kind);
      if (!isInt(source.hex) || source.hex < 0 || kind === undefined) {
        throw new MessageError('Некорректная метка');
      }
      return { t: 'mark', hex: source.hex, kind };
    }
    case 'resync':
      return { t: 'resync' };
    case 'watch':
      if (!isInt(source.player) || source.player < 0 || source.player > 1000) {
        throw new MessageError('Некорректный watch');
      }
      return { t: 'watch', player: source.player };
    case 'select': {
      if (source.hex !== null && !isInt(source.hex)) throw new MessageError('Некорректный select');
      return { t: 'select', hex: source.hex };
    }
    case 'query': {
      if (!isInt(source.id)) throw new MessageError('Некорректный query');
      return { t: 'query', id: source.id, q: decodeQuery(source.q) };
    }
    default:
      throw new MessageError('Неизвестный тип сообщения');
  }
}

/** Кодирует сообщение сервера (снимок и дельта кодируются отдельно). */
export function encodeServerMessage(message: S2C): string {
  return JSON.stringify(message);
}

/** Кодирует сообщение клиента (для тестов и клиентской сети). */
export function encodeClientMessage(message: C2S): string {
  return JSON.stringify(message);
}
