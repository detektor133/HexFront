import { useEffect, useRef } from 'react';

import type { PlayerView } from '@hexfront/sim';

import {
  gameTelemetry,
  percentile,
  type CacheTelemetry,
  type PixiTelemetry,
  type SnapshotTelemetryCounts,
  type TelemetryLine,
  type WorkerTelemetry,
} from './telemetry.ts';

interface MemoryPerformance extends Performance {
  readonly memory?: { readonly usedJSHeapSize: number; readonly totalJSHeapSize: number };
}

export interface TelemetrySource {
  view(): PlayerView | null;
  pixi(): PixiTelemetry;
  worker(): WorkerTelemetry | null;
  snapshots(): SnapshotTelemetryCounts;
  caches(): CacheTelemetry;
}

/** Записывает dev-метрики раз в 5 секунд; production-сборка не создаёт наблюдателей. */
export function useTelemetry(source: TelemetrySource): () => void {
  const lines = useRef<TelemetryLine[]>([]);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const started = performance.now();
    const frames: number[] = [];
    let previous = started;
    let animation = 0;
    let longTaskMs = 0;
    const observer = new PerformanceObserver((entries) => {
      longTaskMs += entries.getEntries().reduce((total, entry) => total + entry.duration, 0);
    });
    try {
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // Браузеры без Long Tasks API оставляют нулевой счётчик.
    }
    const frame = (now: number): void => {
      frames.push(now - previous);
      previous = now;
      animation = requestAnimationFrame(frame);
    };
    animation = requestAnimationFrame(frame);
    const timer = window.setInterval(() => {
      const current = sourceRef.current;
      const view = current.view();
      const worker = current.worker();
      if (!view || !worker) return;
      const memory = performance as MemoryPerformance;
      const line: TelemetryLine = {
        realSeconds: (performance.now() - started) / 1000,
        tick: view.tick,
        matchSeconds: view.tick / 10,
        frameMs: {
          p50: percentile(frames, 0.5),
          p95: percentile(frames, 0.95),
          max: frames.length === 0 ? 0 : Math.max(...frames),
        },
        longTaskMs,
        heap: {
          used: memory.memory?.usedJSHeapSize ?? null,
          total: memory.memory?.totalJSHeapSize ?? null,
        },
        pixi: current.pixi(),
        worker,
        snapshots: current.snapshots(),
        caches: current.caches(),
        game: gameTelemetry(view),
      };
      lines.current.push(line);
      frames.length = 0;
      longTaskMs = 0;
      void fetch('/__telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `${JSON.stringify(line)}\n`,
      });
    }, 5000);
    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(animation);
      observer.disconnect();
    };
  }, []);
  return (): void => {
    const body = lines.current.map((line) => JSON.stringify(line)).join('\n');
    const url = URL.createObjectURL(
      new Blob([body ? `${body}\n` : ''], { type: 'application/jsonl' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'telemetry.jsonl';
    link.click();
    URL.revokeObjectURL(url);
  };
}
