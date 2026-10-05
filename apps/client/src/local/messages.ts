// Сообщения между страницей и Web Worker локального режима (overview.md, «Локальный режим»).
import type {
  Command,
  ConstructionCheck,
  CityInfo,
  Fp,
  PlayerView,
  RecruitCheck,
  RejectReason,
  UnitType,
  GameEvent,
} from '@hexfront/sim';

/** Один размер набора в своём городе: число солдат, цена, время и причина отказа. */
export interface RecruitAmount {
  readonly soldiers: Fp;
  readonly check: RecruitCheck;
}

/** Варианты набора в своём городе для карточки города. */
export interface RecruitOption {
  readonly type: UnitType;
  readonly amounts: RecruitAmount[];
}

/** Что можно сделать с выбранным гексом: цены и причины отказа для кнопок. */
export interface Selection {
  readonly hex: number;
  /** Лимит населения гекса, fixed-point людей. */
  readonly popCap: number;
  readonly city: CityInfo | null;
  readonly foundCity: ConstructionCheck;
  readonly improve: ConstructionCheck;
  readonly fort: ConstructionCheck;
  readonly depot: ConstructionCheck;
  /** Набор — только в своём городе; иначе пусто. */
  readonly recruit: readonly RecruitOption[];
}

export type ToWorker =
  | {
      readonly t: 'start';
      readonly map: unknown;
      readonly seed: number;
      readonly players: number;
      readonly fog: boolean;
      /** Игроки под мозгом бота (09-bots.md). */
      readonly bots: readonly number[];
      /** Тиков sim за 100 мс: 1 — реальное время, больше — ускорение (запись матча). */
      readonly speed: number;
    }
  | { readonly t: 'command'; readonly cmd: Command }
  | { readonly t: 'fog'; readonly on: boolean }
  | { readonly t: 'pause'; readonly on: boolean }
  | { readonly t: 'step' }
  | { readonly t: 'speed'; readonly value: number }
  | { readonly t: 'observer'; readonly playerId: number | null }
  | { readonly t: 'view'; readonly playerId: number | null; readonly fog: boolean }
  | { readonly t: 'select'; readonly hex: number | null }
  | { readonly t: 'ack'; readonly seq: number };

export interface ViewPayload {
  readonly t: 'view';
  readonly seq: number;
  readonly view: PlayerView;
  readonly selection: Selection | null;
  readonly rejected: readonly { readonly command: string; readonly reason: RejectReason }[];
  readonly events: readonly GameEvent[];
}

export type FromWorker = ViewPayload | { readonly t: 'error'; readonly errors: readonly string[] };
