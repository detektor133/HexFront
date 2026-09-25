// Сообщения между страницей и Web Worker локального режима (overview.md, «Локальный режим»).
import type { Command, ConstructionCheck, CityInfo, PlayerView, RejectReason } from '@hexfront/sim';

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
