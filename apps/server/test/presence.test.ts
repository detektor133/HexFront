import { describe, expect, it } from 'vitest';

import { Presence, VISITOR_TTL_MS } from '../src/presence.ts';

describe('Presence: сколько людей в сети', () => {
  it('считает посетителей меню по различным адресам и забывает их по сроку', () => {
    const presence = new Presence();
    presence.visit('1.1.1.1', 0);
    presence.visit('1.1.1.1', 1000);
    presence.visit('2.2.2.2', 1000);
    expect(presence.count(2000)).toBe(2);
    expect(presence.count(1000 + VISITOR_TTL_MS + 1)).toBe(0);
  });

  it('открытый сокет держит адрес в сети без опросов и не удваивает посетителя', () => {
    const presence = new Presence();
    presence.visit('1.1.1.1', 0);
    presence.socketOpened('1.1.1.1');
    presence.socketOpened('3.3.3.3');
    expect(presence.count(VISITOR_TTL_MS * 5)).toBe(2);
    presence.socketClosed('3.3.3.3');
    expect(presence.count(VISITOR_TTL_MS * 5)).toBe(1);
  });
});
