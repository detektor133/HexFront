import { describe, expect, it } from 'vitest';

import {
  decodeClientMessage,
  decodeMaskRle,
  encodeMaskRle,
  encodeClientMessage,
  MAX_CLIENT_MESSAGE_BYTES,
  MessageError,
  PROTOCOL_VERSION,
  validateCommand,
} from '../src/index.ts';

describe('сообщения клиента', () => {
  it('разбирает hello, cmd, viewAck, ping и start', () => {
    const hello = encodeClientMessage({
      t: 'hello',
      v: PROTOCOL_VERSION,
      nick: 'Аня',
      mode: 'open',
    });
    expect(decodeClientMessage(hello)).toMatchObject({ t: 'hello', nick: 'Аня', mode: 'open' });
    expect(
      decodeClientMessage('{"t":"cmd","seq":3,"cmd":{"t":"move","unitIds":[1,2],"to":9}}'),
    ).toMatchObject({ t: 'cmd', seq: 3 });
    expect(decodeClientMessage('{"t":"viewAck","tick":5}')).toEqual({ t: 'viewAck', tick: 5 });
    expect(decodeClientMessage('{"t":"ping","at":1}')).toEqual({ t: 'ping', at: 1 });
    expect(decodeClientMessage('{"t":"start"}')).toEqual({ t: 'start' });
  });

  it.each([
    '',
    'не json',
    '[]',
    '{"t":"hello","v":"1","nick":"a"}',
    '{"t":"hello","v":1,"nick":"a","mode":"x"}',
    '{"t":"cmd","seq":1.5,"cmd":{"t":"setTax","rate":1}}',
    '{"t":"cmd","seq":1,"cmd":{"t":"unknown"}}',
    '{"t":"viewAck","tick":"1"}',
    '{"t":"bogus"}',
  ])('отклоняет некорректное сообщение %j', (text) => {
    expect(() => decodeClientMessage(text)).toThrow(MessageError);
  });

  it('отклоняет слишком большое сообщение', () => {
    const text = JSON.stringify({
      t: 'hello',
      v: 1,
      nick: 'x',
      token: 'a'.repeat(MAX_CLIENT_MESSAGE_BYTES),
    });
    expect(() => decodeClientMessage(text)).toThrow(MessageError);
  });
});

describe('проверка формы команды', () => {
  it('принимает известные команды с простыми полями', () => {
    expect(validateCommand({ t: 'setTax', rate: 300 })).not.toBeNull();
    expect(
      validateCommand({ t: 'setOffensiveLine', armyId: 1, edges: [1], lines: [[1], [2]] }),
    ).not.toBeNull();
    expect(
      validateCommand({
        t: 'launchOffensive',
        target: -1,
        soldiers: 5,
        mix: { armor: 1, artillery: 0 },
      }),
    ).not.toBeNull();
    expect(validateCommand({ t: 'assignUnits', unitIds: [1], armyId: null })).not.toBeNull();
  });

  it('отбрасывает чужой source, неизвестный тип, дробные и вложенные поля', () => {
    expect(validateCommand({ t: 'setTax', rate: 1, source: 'auto' })).toBeNull();
    expect(validateCommand({ t: 'hack' })).toBeNull();
    expect(validateCommand({ t: 'setTax', rate: 1.5 })).toBeNull();
    expect(validateCommand({ t: 'move', unitIds: [{}], to: 1 })).toBeNull();
    expect(
      validateCommand({ t: 'move', unitIds: Array.from({ length: 600 }, (_, i) => i), to: 1 }),
    ).toBeNull();
    expect(validateCommand({ t: 'renameCity', cityId: 1, name: 'x'.repeat(41) })).toBeNull();
    expect(validateCommand(JSON.parse('{"t":"setTax","__proto__":1,"rate":1}'))).toBeNull();
    expect(validateCommand(null)).toBeNull();
    expect(validateCommand([])).toBeNull();
  });
});

describe('запросы, возобновление и маски', () => {
  it('разбирает select, query, resync и have', () => {
    expect(decodeClientMessage('{"t":"select","hex":null}')).toEqual({ t: 'select', hex: null });
    expect(decodeClientMessage('{"t":"select","hex":5}')).toEqual({ t: 'select', hex: 5 });
    expect(decodeClientMessage('{"t":"resync"}')).toEqual({ t: 'resync' });
    expect(
      decodeClientMessage('{"t":"query","id":3,"q":{"kind":"mask","mode":"supply"}}'),
    ).toMatchObject({ t: 'query', id: 3 });
    expect(
      decodeClientMessage(
        '{"t":"query","id":4,"q":{"kind":"path","unitIds":[1],"to":9,"via":[2]}}',
      ),
    ).toMatchObject({ t: 'query', q: { kind: 'path', to: 9 } });
    expect(decodeClientMessage('{"t":"hello","v":1,"nick":"Аня","have":42}')).toMatchObject({
      have: 42,
    });
  });

  it.each([
    '{"t":"select","hex":"5"}',
    '{"t":"query","id":1,"q":{"kind":"mask","mode":"hack"}}',
    '{"t":"query","id":1,"q":{"kind":"path","unitIds":"x","to":1,"via":[]}}',
    '{"t":"query","id":1,"q":{"kind":"path","unitIds":[1],"to":1,"via":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]}}',
    '{"t":"query","id":1,"q":{"kind":"other"}}',
    '{"t":"hello","v":1,"nick":"Аня","have":-1}',
  ])('отклоняет %s', (text) => {
    expect(() => decodeClientMessage(text)).toThrow(MessageError);
  });

  it('маска сжимается повторами и разворачивается без потерь', () => {
    const mask = Uint8Array.from([0, 0, 0, 2, 2, 1, 0, 0, 3]);
    expect(decodeMaskRle(encodeMaskRle(mask), mask.length)).toEqual(mask);
    expect(encodeMaskRle(new Uint8Array(1000))).toEqual([0, 1000]);
    // Чужой размер не раздувает память и не пишет за пределы.
    expect(decodeMaskRle([1, 1_000_000], 10)).toEqual(new Uint8Array(10).fill(1));
  });
});
