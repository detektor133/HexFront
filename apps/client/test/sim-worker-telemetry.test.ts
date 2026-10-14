import { describe, expect, it, vi } from 'vitest';

const snapshotView = { tick: 0 } as never;
const snapshot = {
  t: 'view' as const,
  seq: 0,
  view: snapshotView,
  kind: 'snapshot' as const,
  snapshot: { t: 'snapshot' as const, tick: 0, view: snapshotView },
  selection: null,
  rejected: [],
  events: [],
};

vi.mock('../src/local/engine.ts', () => ({
  createLocalEngine: vi.fn(() => ({
    state: { winner: -1 },
    snapshot: vi.fn(() => snapshot),
    advance: vi.fn(),
    queue: vi.fn(),
    setFog: vi.fn(),
    setObserver: vi.fn(),
    setView: vi.fn(),
    select: vi.fn(),
  })),
}));

describe('сериализация телеметрии worker', () => {
  it('не вызывает JSON.stringify пакета без включённой телеметрии', async () => {
    const postMessage = vi.fn();
    Object.assign(globalThis, {
      postMessage,
      onmessage: null,
      performance: { now: vi.fn(() => 0) },
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    });
    const stringify = vi.spyOn(JSON, 'stringify');
    await import('../src/local/sim-worker.ts');

    const handler = globalThis.onmessage as (event: MessageEvent) => void;
    handler({
      data: {
        t: 'start',
        map: {},
        seed: 42,
        players: 2,
        bots: [],
        fog: true,
        speed: 1,
        telemetry: false,
      },
    } as MessageEvent);

    expect(stringify).not.toHaveBeenCalled();
    expect(postMessage.mock.calls[0]?.[0]).not.toHaveProperty('telemetry');
    stringify.mockRestore();
  });

  it('вызывает JSON.stringify пакета при включённой телеметрии', async () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const handler = globalThis.onmessage as (event: MessageEvent) => void;

    handler({
      data: {
        t: 'start',
        map: {},
        seed: 42,
        players: 2,
        bots: [],
        fog: true,
        speed: 1,
        telemetry: true,
      },
    } as MessageEvent);

    expect(stringify).toHaveBeenCalled();
    stringify.mockRestore();
  });
});
