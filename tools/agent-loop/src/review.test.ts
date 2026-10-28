import { describe, expect, it } from 'vitest';

import { parseReviewVerdict } from './review.ts';

describe('протокол reviewer', () => {
  it('принимает структурированный ответ и отвергает противоречивый', () => {
    expect(parseReviewVerdict('{"outcome":"OK","findings":[]}')).toEqual({
      ok: true,
      findings: [],
    });
    expect(
      parseReviewVerdict(
        '{"outcome":"ВОЗВРАТ","findings":[{"kind":"ТЕСТ","text":"нет проверки Esc"}]}',
      ),
    ).toEqual({
      ok: false,
      findings: [{ kind: 'ТЕСТ', text: 'ТЕСТ: нет проверки Esc' }],
    });
    expect(
      parseReviewVerdict(
        '{"outcome":"ВОЗВРАТ","findings":[{"kind":"ТЕСТ","basis":"gate","text":"старый таймаут"}]}',
      ),
    ).toEqual({
      ok: false,
      findings: [{ kind: 'ТЕСТ', basis: 'gate', text: 'ТЕСТ: старый таймаут' }],
    });
    expect(
      parseReviewVerdict('{"outcome":"OK","findings":[{"kind":"КОД","text":"баг"}]}'),
    ).toBeUndefined();
  });
  it('принимает строгий OK без замечаний', () => {
    expect(parseReviewVerdict('OK\nКритерии подтверждены.')).toEqual({ ok: true, findings: [] });
  });

  it('разбирает все дефекты и сохраняет их порядок', () => {
    expect(
      parseReviewVerdict(
        'ВОЗВРАТ\n- КОД: критерий 1 — команда не отправлена, src/runtime.ts:41\n- ТЕСТ: критерий 2 — нет проверки ошибки, test/runtime.test.ts:72',
      ),
    ).toEqual({
      ok: false,
      findings: [
        { kind: 'КОД', text: 'КОД: критерий 1 — команда не отправлена, src/runtime.ts:41' },
        { kind: 'ТЕСТ', text: 'ТЕСТ: критерий 2 — нет проверки ошибки, test/runtime.test.ts:72' },
      ],
    });
  });

  it('передаёт непроверяемый критерий роли plan', () => {
    expect(parseReviewVerdict('ВОЗВРАТ\n- ПЛАН: jsdom не вычисляет геометрию CSS')).toEqual({
      ok: false,
      findings: [{ kind: 'ПЛАН', text: 'ПЛАН: jsdom не вычисляет геометрию CSS' }],
    });
  });

  it.each(['свободный текст', 'ВОЗВРАТ', 'ВОЗВРАТ\n- замечание без маршрута', '**OK**'])(
    'отклоняет неструктурированный ответ: %s',
    (message) => {
      expect(parseReviewVerdict(message)).toBeUndefined();
    },
  );
});
