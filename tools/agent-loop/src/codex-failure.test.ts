import { describe, expect, it } from 'vitest';

import { codexFailure, USAGE_LIMIT } from './codex.ts';

describe('сбой сессии codex', () => {
  it('отделяет отказ запуска инструмента от исхода reviewer', () => {
    expect(
      codexFailure(
        '{"outcome":"ВОЗВРАТ","findings":[{"kind":"ПЛАН","text":"не удалось прочитать diff"}]}',
        'Failed to create unified exec process: helper_unknown_error: setup refresh had errors',
        1,
      ),
    ).toBe('инструмент Codex не запустился');
  });

  it('сохраняет отдельный исход лимита и обычного ненулевого кода', () => {
    expect(codexFailure('hit your usage limit', '', 0)).toBe(USAGE_LIMIT);
    expect(codexFailure('Ошибка', '', 1)).toBe('codex завершился с кодом 1');
    expect(
      codexFailure(
        '{"outcome":"OK","findings":[]}',
        'В документации упомянуто `setup refresh had errors`.',
        0,
      ),
    ).toBeUndefined();
  });

  it('не принимает ошибку внутренней команды за сбой успешно завершённой сессии', () => {
    const stderr = [
      'OpenAI Codex v0.161.0',
      'exec_command failed:',
      'Failed to create unified exec process: Неверно задано имя папки. (os error 267)',
      'codex',
      'Исправил путь, проверки прошли, коммит создан.',
    ].join('\n');
    expect(codexFailure('Коммит создан; verify прошёл.', stderr, 0)).toBeUndefined();
    expect(codexFailure('Работа прервана.', stderr, 1)).toBe('codex завершился с кодом 1');
  });
});
