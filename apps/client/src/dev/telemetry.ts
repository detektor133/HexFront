import type { PlayerView } from '@hexfront/sim';

import type {
  EconomyLayerCacheTelemetry,
  FrontTweenCacheTelemetry,
  UnitLayerCacheTelemetry,
} from './cache-telemetry.ts';
import type { GraphicsTelemetry } from '../render/graphics-telemetry.ts';

export interface WorkerTelemetry {
  readonly tickMsAvg: number;
  readonly tickMsMax: number;
  readonly snapshotBytes: number;
  readonly ackMs: number | null;
}

export interface SnapshotTelemetryCounts {
  readonly received: number;
  readonly collected: number;
  readonly live: number;
}

interface SnapshotRegistry {
  register(snapshot: object): void;
}

type CreateSnapshotRegistry = (onCollected: () => void) => SnapshotRegistry;

export interface SnapshotTelemetry {
  track(snapshot: object): void;
  counts(): SnapshotTelemetryCounts;
}

const createFinalizationRegistry: CreateSnapshotRegistry = (onCollected) => {
  const registry = new FinalizationRegistry(onCollected);
  return { register: (snapshot) => registry.register(snapshot, undefined) };
};

/** Отслеживает сообщения воркера, которые ещё не освободил сборщик мусора. */
export function createSnapshotTelemetry(
  createRegistry: CreateSnapshotRegistry = createFinalizationRegistry,
): SnapshotTelemetry {
  let received = 0;
  let collected = 0;
  const registry = createRegistry(() => {
    collected += 1;
  });
  return {
    track(snapshot) {
      received += 1;
      registry.register(snapshot);
    },
    counts: () => ({ received, collected, live: Math.max(0, received - collected) }),
  };
}

export interface PixiTelemetry {
  readonly objects: number;
  readonly text: number;
  readonly graphics: number;
  readonly graphicsInstructions: readonly number[];
  readonly graphicsDetails: readonly GraphicsTelemetry[];
  readonly textures: number;
  readonly canvasTextTextures: number | null;
}

export interface CacheTelemetry {
  readonly unit: UnitLayerCacheTelemetry;
  readonly economy: EconomyLayerCacheTelemetry;
  readonly frontTween: FrontTweenCacheTelemetry;
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
  readonly snapshots: SnapshotTelemetryCounts;
  readonly caches: CacheTelemetry;
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
