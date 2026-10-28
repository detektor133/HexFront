import { describe, expect, it } from 'vitest';

import { parsePlanMessage } from './role-output.ts';

describe('протокол plan', () => {
  it('принимает структурированный исход и старый ответ при восстановлении', () => {
    expect(parsePlanMessage('{"outcome":"переделать","detail":"переписать фикстуру"}')).toEqual({
      outcome: 'переделать',
      detail: 'переписать фикстуру',
    });
    expect(parsePlanMessage('Причина проверена.\nPLAN: не трогал')).toEqual({
      outcome: 'не трогал',
      detail: '',
    });
  });

  it('отвергает неизвестный исход и битый JSON', () => {
    expect(parsePlanMessage('{"outcome":"готово","detail":""}')).toBeUndefined();
    expect(parsePlanMessage('{"outcome":')).toBeUndefined();
  });
});
