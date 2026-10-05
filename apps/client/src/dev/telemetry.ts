import type { PlayerView } from '@hexfront/sim';

export interface WorkerTelemetry {
  readonly tickMsAvg: number;
  readonly tickMsMax: number;
  readonly snapshotBytes: number;
  readonly ackMs: number | null;
}

export interface PixiTelemetry {
  readonly objects: number;
  readonly text: number;
  readonly graphics: number;
  readonly textures: number;
  readonly canvasTextTextures: number | null;
}

export interface TelemetryLine {
  readonly realSeconds: number;
  readonly tick: number;
  readonly matchSeconds: number;
  readonly frameMs: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly longTaskMs: number;
  readonly heap: { readonly used: number | null; readonly total: number | null };
  readonly pixi: PixiTelemetry;
  readonly worker: WorkerTelemetry;
  readonly game: {
    readonly units: number;
    readonly armies: number;
    readonly fronts: number;
    readonly battles: number;
    readonly alivePlayers: number;
  };
}

export function percentile(samples: readonly number[], ratio: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

/** Собирает счётчики игры из снимка, не добавляя данных в симуляцию. */
export function gameTelemetry(view: PlayerView): TelemetryLine['game'] {
  return {
    units: view.units.length,
    armies: view.armies.length,
    fronts: view.plans.length,
    battles: view.units.filter((unit) => unit.order === 'attack').length,
    alivePlayers: view.players.filter((player) => player.status === 'alive').length,
  };
}
