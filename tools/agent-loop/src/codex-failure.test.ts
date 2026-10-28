import { describe, expect, it } from 'vitest';

import { codexFailure, USAGE_LIMIT } from './codex.ts';

describe('сбой сессии codex', () => {
  it('отделяет отказ запуска инструмента от исхода reviewer', () => {
    expect(
      codexFailure(
        '{"outcome":"ВОЗВРАТ","findings":[{"kind":"ПЛАН","text":"не удалось прочитать diff"}]}',
        'Failed to create unified exec process: helper_unknown_error: setup refresh had errors',
        0,
      ),
    ).toBe('инструмент Codex не запустился');
  });

  it('сохраняет отдельный исход лимита и обычного ненулевого кода', () => {
    expect(codexFailure('hit your usage limit', '', 0)).toBe(USAGE_LIMIT);
    expect(codexFailure('Ошибка', '', 1)).toBe('codex завершился с кодом 1');
  });
});
