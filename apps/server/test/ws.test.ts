import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import {
  decodeSnapshot,
  encodeClientMessage,
  PROTOCOL_VERSION,
  type C2S,
} from '@hexfront/protocol';
import { loadMap } from '@hexfront/sim';

import small from '../../../packages/mapgen/maps/small.json' with { type: 'json' };
import { Hub } from '../src/hub.ts';
import { originAllowed, startServer, type RunningServer } from '../src/server.ts';

const loaded = loadMap(small);
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));

let running: RunningServer | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

/** Ждёт сообщение сервера, подходящее под условие. */
function waitFor(socket: WebSocket, wanted: (text: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('сообщение не пришло'));
    }, 5000);
    const onMessage = (data: unknown): void => {
      const text = String(data);
      if (!wanted(text)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(text);
    };
    socket.on('message', onMessage);
  });
}

const open = (port: number): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.once('open', () => {
      resolve(socket);
    });
    socket.once('error', reject);
  });

const send = (socket: WebSocket, message: C2S): void => {
  socket.send(encodeClientMessage(message));
};

describe('сервер по сети', () => {
  it('отвечает на /healthz и ведёт матч двух людей по ws', async () => {
    const hub = new Hub({ size: 6, makeMap: () => loaded.map });
    running = await startServer(hub, 0, { host: '127.0.0.1' });
    const health = (await (await fetch(`http://127.0.0.1:${running.port}/healthz`)).json()) as {
      ok: boolean;
    };
    expect(health.ok).toBe(true);

    const a = await open(running.port);
    const b = await open(running.port);
    send(a, { t: 'hello', v: PROTOCOL_VERSION, nick: 'Аня', mode: 'private' });
    const welcome = JSON.parse(await waitFor(a, (t) => t.includes('"welcome"'))) as {
      room: string;
    };
    send(b, { t: 'hello', v: PROTOCOL_VERSION, nick: 'Борис', room: welcome.room });
    await waitFor(b, (t) => t.includes('"welcome"'));

    const snapshotA = waitFor(a, (t) => t.includes('"t":"snapshot"'));
    const snapshotB = waitFor(b, (t) => t.includes('"t":"snapshot"'));
    send(a, { t: 'start' });
    const viewA = decodeSnapshot(await snapshotA).view;
    const viewB = decodeSnapshot(await snapshotB).view;
    expect(viewA.playerId).toBe(0);
    expect(viewB.playerId).toBe(1);

    send(a, { t: 'viewAck', tick: viewA.tick });
    const delta = await waitFor(a, (t) => t.includes('"t":"delta"'));
    // Окно отправки: к моменту чтения могла уйти не первая дельта, но база не раньше снимка.
    const parsed = JSON.parse(delta) as { baseTick: number; tick: number };
    expect(parsed.baseTick).toBeGreaterThanOrEqual(viewA.tick);
    expect(parsed.tick).toBeGreaterThan(parsed.baseTick);

    send(a, { t: 'ping', at: 7 });
    expect(JSON.parse(await waitFor(a, (t) => t.includes('"pong"'))).at).toBe(7);
    a.close();
    b.close();
  });
});

describe('проверка Origin', () => {
  it('пусто — любой; иначе точное совпадение или шаблон поддомена', () => {
    expect(originAllowed(undefined, [])).toBe(true);
    expect(originAllowed(undefined, ['https://a.com'])).toBe(false);
    expect(originAllowed('https://a.com', ['https://a.com'])).toBe(true);
    expect(originAllowed('https://evil.com', ['https://a.com'])).toBe(false);
    const rules = ['https://*.hexfront.pages.dev'];
    expect(originAllowed('https://stage-09.hexfront.pages.dev', rules)).toBe(true);
    expect(originAllowed('https://hexfront.pages.dev', rules)).toBe(false);
    expect(originAllowed('https://hexfront.pages.dev.evil.com', rules)).toBe(false);
    expect(originAllowed('http://x.hexfront.pages.dev', rules)).toBe(false);
  });
});
