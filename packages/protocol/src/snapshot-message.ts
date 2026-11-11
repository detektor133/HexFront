import type { PlayerView } from '@hexfront/sim';

/** Полный снимок вида игрока: начало потока и база первой дельты. */
export interface SnapshotMessage {
  readonly t: 'snapshot';
  readonly tick: number;
  readonly view: PlayerView;
}
