import { describe, expect, it } from 'vitest';

import {
  decodeClientMessage,
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
