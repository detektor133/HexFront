import { describe, expect, it } from 'vitest';

import { createSnapshotTelemetry, percentile } from '../src/dev/telemetry.ts';

describe('телеметрия стенда', () => {
  it('считает p50 и p95 по отсортированной копии кадров', () => {
    const samples = [20, 1, 5, 10, 15];

    expect(percentile(samples, 0.5)).toBe(10);
    expect(percentile(samples, 0.95)).toBe(20);
    expect(samples).toEqual([20, 1, 5, 10, 15]);
  });

  it('считает полученные и собранные снимки воркера', () => {
    const finalizer: { callback: (() => void) | null } = { callback: null };
    const telemetry = createSnapshotTelemetry((cleanup) => ({
      register(_snapshot) {
        finalizer.callback = cleanup;
      },
    }));

    telemetry.track({});
    telemetry.track({});
    finalizer.callback?.();

    expect(telemetry.counts()).toEqual({ received: 2, collected: 1, live: 1 });
  });
});
