import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

const tinyMap: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);

function setWorkerGlobals(): void {
  Object.assign(globalThis, {
    postMessage: vi.fn(),
    onmessage: null,
    performance: { now: vi.fn(() => 0) },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  });
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('сериализация телеметрии worker', () => {
  it('не вызывает JSON.stringify пакета без включённой телеметрии', async () => {
    setWorkerGlobals();
    const stringify = vi.spyOn(JSON, 'stringify');
    await import('../src/local/sim-worker.ts');

    const handler = globalThis.onmessage as (event: MessageEvent) => void;
    handler({
      data: {
        t: 'start',
        map: tinyMap,
        seed: 42,
        players: 2,
        bots: [],
        fog: true,
        speed: 1,
        telemetry: false,
      },
    } as MessageEvent);

    expect(stringify).not.toHaveBeenCalled();
    expect(vi.mocked(globalThis.postMessage).mock.calls[0]?.[0]).not.toHaveProperty('telemetry');
  });

  it('вызывает JSON.stringify пакета при включённой телеметрии', async () => {
    setWorkerGlobals();
    const stringify = vi.spyOn(JSON, 'stringify');
    await import('../src/local/sim-worker.ts');

    const handler = globalThis.onmessage as (event: MessageEvent) => void;
    handler({
      data: {
        t: 'start',
        map: tinyMap,
        seed: 42,
        players: 2,
        bots: [],
        fog: true,
        speed: 1,
        telemetry: true,
      },
    } as MessageEvent);

    expect(stringify).toHaveBeenCalled();
  });
});
