import { afterEach, describe, expect, it, vi } from 'vitest';

import { startLocalMatch } from '../src/local/local-match.ts';
import { readLocalMatchSetup } from '../src/local/match-setup.ts';

class TestWorker {
  static instances: TestWorker[] = [];
  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    TestWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {}
}

const originalWorker = globalThis.Worker;

afterEach(() => {
  Object.defineProperty(globalThis, 'Worker', { value: originalWorker, configurable: true });
  TestWorker.instances = [];
  vi.restoreAllMocks();
});

describe('запуск локального матча', () => {
  it('передаёт worker 30 игроков, 29 ботов и процедурную карту', () => {
    Object.defineProperty(globalThis, 'Worker', { value: TestWorker, configurable: true });
    const setup = readLocalMatchSetup('?map=gen&seed=42&players=30');

    const match = startLocalMatch({ map: true }, setup.map.seed, setup, () => {});
    const start = TestWorker.instances[0]?.messages[0];

    expect(start).toEqual({
      t: 'start',
      map: { map: true },
      seed: 42,
      players: 30,
      bots: Array.from({ length: 29 }, (_, index) => index + 1),
      speed: 1,
      fog: true,
    });
    match.dispose();
  });
});
