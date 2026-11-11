// Сообщения клиент ↔ сервер (docs/architecture/protocol.md). Снимок и дельта кодируются в index.ts.
// Входящее от клиента проверяется вручную и считается недоверенным: форма, типы, длины, лимиты.
import type { Command, RejectReason } from '@hexfront/sim';

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
    }
  /**
   * Команда с возрастающим номером `seq` в рамках сессии. Повтор (после обрыва) с тем же `seq`
   * сервер не исполняет второй раз, а только подтверждает: `ack` накопительный.
   */
  | { readonly t: 'cmd'; readonly seq: number; readonly cmd: Command }
  /** Клиент потерял базу дельты (ошибка применения): сервер шлёт полный снимок. */
  | { readonly t: 'resync' }
  | { readonly t: 'viewAck'; readonly tick: number }
  | { readonly t: 'ping'; readonly at: number }
  /** Хозяин закрытой комнаты запускает матч раньше срока (остальные места займут боты). */
  | { readonly t: 'start' };

/** Причины, по которым сервер закрывает вход. */
export type RefuseReason =
  | 'versionMismatch'
  | 'badNick'
  | 'roomFull'
  | 'noRoom'
  | 'badHello'
  /** Сервер перегружен (лимит комнат) или слишком много входов с адреса. */
  | 'busy';

export interface LobbyInfo {
  readonly room: string;
  readonly humans: number;
  readonly max: number;
  /** Секунд до старта сбора; `null` — ждём хозяина. */
  readonly startsInS: number | null;
  readonly open: boolean;
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
      readonly fog: boolean;
    }
  | { readonly t: 'lobby'; readonly info: LobbyInfo }
  | { readonly t: 'start'; readonly tick: number }
  | { readonly t: 'ack'; readonly seq: number }
  | {
      readonly t: 'rejected';
      readonly seq: number;
      readonly reason: RejectReason | 'rateLimit' | 'bad';
    }
  | { readonly t: 'refused'; readonly reason: RefuseReason }
  | { readonly t: 'end'; readonly winner: number; readonly tick: number }
  | { readonly t: 'pong'; readonly at: number };

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
    case 'resync':
      return { t: 'resync' };
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
