// Интерфейс матча для экрана игры: его реализуют локальный воркер и онлайн-матч.
import type { Command } from '@hexfront/sim';

import type { MapMaskMode } from './messages.ts';

export interface LocalMatch {
  send(cmd: Command): void;
  setFog(on: boolean): void;
  /** Шаг матча-урока для режиссёра соперника. */
  setTutorialStage?(stage: string): void;
  setPaused(on: boolean): void;
  step(): void;
  setSpeed(value: number): void;
  setObserver(playerId: number | null): void;
  setView(playerId: number | null, fog: boolean): void;
  select(hex: number | null): void;
  /** Ответ придёт в onMessage сообщением `pathPreview` с тем же requestId. */
  previewPath?(
    requestId: number,
    unitIds: readonly number[],
    to: number,
    via: readonly number[],
  ): void;
  /** Ответ придёт в onMessage сообщением mapMask с тем же requestId. */
  requestMask?(requestId: number, mode: MapMaskMode): void;
  ack(seq: number): void;
  /** Экран не смог применить вид (потерял базу дельты): запросить полный снимок (сетевой матч). */
  resync?(): void;
  dispose(): void;
}
