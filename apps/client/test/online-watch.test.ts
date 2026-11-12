import { describe, expect, it } from 'vitest';

import type { NetClock, NetSocket } from '../src/net/net-client.ts';
import { startOnlineMatch } from '../src/net/online-match.ts';

class FakeSocket implements NetSocket {
  public readonly sent: string[] = [];
  private opened: (() => void) | null = null;
  private received: ((text: string) => void) | null = null;
  public send(text: string): void {
    this.sent.push(text);
  }
  public close(): void {}
  public onOpen(handler: () => void): void {
    this.opened = handler;
  }
  public onMessage(handler: (text: string) => void): void {
    this.received = handler;
  }
  public onClose(): void {}
  public open(): void {
    this.opened?.();
  }
  public receive(message: object): void {
    this.received?.(JSON.stringify(message));
  }
}

const clock: NetClock = {
  now: () => 0,
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

describe('онлайн-наблюдение', () => {
  it('смена наблюдаемого уходит серверу, повтор того же не шлётся, null возвращает к себе', () => {
    const socket = new FakeSocket();
    const match = startOnlineMatch({
      connect: () => socket,
      token: 't',
      nick: 'Аня',
      mapSize: 4,
      clock,
      onMessage: () => undefined,
    });
    socket.open();
    socket.receive({
      t: 'welcome',
      playerId: 2,
      token: 't',
      room: 'R',
      tickMs: 100,
      map: 'gen',
      seed: 1,
      players: 6,
      fog: true,
    });

    match.setObserver(4);
    match.setView(4, true);
    match.setObserver(null);

    const watches = socket.sent
      .map((text) => JSON.parse(text) as { t: string; player?: number })
      .filter((m) => m.t === 'watch');
    expect(watches).toEqual([
      { t: 'watch', player: 4 },
      { t: 'watch', player: 2 },
    ]);
  });
});
