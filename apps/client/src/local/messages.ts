// Сообщения между страницей и Web Worker локального режима (overview.md, «Локальный режим»).
import type { DeltaMessage, SnapshotMessage } from '@hexfront/protocol';
import type {
  RecruitAmount,
  RecruitOption,
  Selection,
  PathPreview,
  Command,
  BotLevel,
  PlayerView,
  RejectReason,
  GameEvent,
} from '@hexfront/sim';

export type { RecruitAmount, RecruitOption, Selection };

import type { WorkerTelemetry } from '../dev/telemetry.ts';

/** Режим карты: снабжение или стройка (build:city, build:fort, build:depot, build:improve). */
export type MapMaskMode = 'supply' | 'build:city' | 'build:fort' | 'build:depot' | 'build:improve';

export type ToWorker =
  | {
      readonly t: 'start';
      readonly map: unknown;
      readonly seed: number;
      readonly players: number;
      readonly fog: boolean;
      readonly telemetry?: boolean;
      /** Игроки под мозгом бота (09-bots.md). */
      readonly bots: readonly number[];
      /** Тиков sim за 100 мс: 1 — реальное время, больше — ускорение (запись матча). */
      readonly speed: number;
      readonly playerName?: string;
      readonly playerColors?: readonly string[];
      readonly initialGold?: number;
      /** Матч-урок: стартовые отряды не получают автозанятие земли. */
      readonly tutorial?: boolean;
      /** Сложность ботов матча; нет поля — полная сила. */
      readonly botLevel?: BotLevel;
      /** Столица человека (id гекса); нет поля — случайная. */
      readonly spawn?: number;
      /** Столицы на любых сухопутных гексах, а не на спавнах карты. */
      readonly freeStarts?: boolean;
      /** Свой список названий городов человека. */
      readonly cityNames?: readonly string[];
    }
  | { readonly t: 'command'; readonly cmd: Command }
  | { readonly t: 'fog'; readonly on: boolean }
  | { readonly t: 'tutorialStage'; readonly stage: string }
  | { readonly t: 'pause'; readonly on: boolean }
  | { readonly t: 'step' }
  | { readonly t: 'speed'; readonly value: number }
  | { readonly t: 'observer'; readonly playerId: number | null }
  | { readonly t: 'view'; readonly playerId: number | null; readonly fog: boolean }
  | { readonly t: 'select'; readonly hex: number | null }
  | {
      readonly t: 'previewPath';
      readonly requestId: number;
      readonly unitIds: readonly number[];
      readonly to: number;
      readonly via: readonly number[];
    }
  | { readonly t: 'mapMask'; readonly requestId: number; readonly mode: MapMaskMode }
  | { readonly t: 'ack'; readonly seq: number };

export interface ViewPayload {
  readonly t: 'view';
  readonly seq: number;
  readonly view: PlayerView;
  readonly kind: 'snapshot';
  readonly snapshot: SnapshotMessage;
  readonly selection: Selection | null;
  readonly rejected: readonly { readonly command: string; readonly reason: RejectReason }[];
  readonly events: readonly GameEvent[];
  readonly telemetry?: WorkerTelemetry;
}

interface DeltaViewPayloadBase {
  readonly t: 'view';
  readonly seq: number;
  /** В дельта-сообщении поле отсутствует в wire-данных; используется для совместимости типов движка. */
  readonly view: PlayerView;
  readonly selection: Selection | null;
  readonly rejected: readonly { readonly command: string; readonly reason: RejectReason }[];
  readonly events: readonly GameEvent[];
  readonly telemetry?: WorkerTelemetry;
}

export type DeltaViewPayload =
  | (DeltaViewPayloadBase & { readonly kind: 'snapshot'; readonly snapshot: SnapshotMessage })
  | (DeltaViewPayloadBase & { readonly kind: 'delta'; readonly delta: DeltaMessage });

export interface PathPreviewReply {
  readonly t: 'pathPreview';
  readonly requestId: number;
  readonly preview: PathPreview | null;
}

export interface MapMaskReply {
  readonly t: 'mapMask';
  readonly requestId: number;
  readonly mode: MapMaskMode;
  readonly mask: Uint8Array;
}

export type FromWorker =
  | ViewPayload
  | MapMaskReply
  | DeltaViewPayload
  | PathPreviewReply
  | { readonly t: 'error'; readonly errors: readonly string[] };
