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
} from '@hexfront/sim';

/** Вариант набора в своём городе для кнопки: тип, размер и цена или причина отказа. */
export interface RecruitOption {
  readonly type: UnitType;
  readonly soldiers: Fp;
  readonly check: RecruitCheck;
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
    }
  | { readonly t: 'command'; readonly cmd: Command }
  | { readonly t: 'select'; readonly hex: number | null };

export type FromWorker =
  | {
      readonly t: 'view';
      readonly view: PlayerView;
      readonly selection: Selection | null;
      readonly rejected: readonly { readonly command: string; readonly reason: RejectReason }[];
    }
  | { readonly t: 'error'; readonly errors: readonly string[] };
