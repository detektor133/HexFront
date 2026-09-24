import { describe, expect, it } from 'vitest';

import { checkCommitMessage } from './commit-check.ts';

const STAGE = { branch: 'stage-02' };
const MAIN = { branch: 'main' };

describe('проверка сообщений коммитов', () => {
  it.each([
    [
      'feat(sim): добавлена система сетей снабжения и изоляции городов\n\n' +
        'Сети пересчитываются раз в секунду, пересчёт размазан по игрокам\n' +
        'через tick % 10, чтобы не было пиков нагрузки.\n\nЭтап: 02/T7',
      STAGE,
    ],
    [
      'fix(sim): армия больше не отступает в гекс с тремя своими армиями\n\n' +
        'Выбор гекса отступления не учитывал MAX_ARMIES_PER_HEX.\n' +
        'Добавлен сценарий «соседи переполнены → капитуляция».\n\nЭтап: 03/T6',
      STAGE,
    ],
    ['balance(sim): максимальный налог поднят с 40 до 50 %\n\nРешение: DECISIONS 2026-10-02', MAIN],
  ])('принимает пример из CONVENTIONS.md №%#', (message, ctx) => {
    expect(checkCommitMessage(message, ctx)).toEqual([]);
  });

  it.each([
    ['без типа и области', 'добавлена система снабжения\n\nЭтап: 02/T7', STAGE],
    ['неизвестный тип', 'feature(sim): добавлена система снабжения\n\nЭтап: 02/T7', STAGE],
    ['заголовок по-английски', 'feat(sim): add supply network system\n\nЭтап: 02/T7', STAGE],
    ['заглавная буква и точка', 'feat(sim): Добавлена система снабжения.\n\nЭтап: 02/T7', STAGE],
    ['нет трейлера «Этап:» в ветке этапа', 'feat(sim): добавлена система снабжения', STAGE],
    ['balance без «Решение:»', 'balance(sim): налог поднят до 50 %', MAIN],
    ['неизвестная область', 'feat(ui): добавлена карточка города\n\nЭтап: 02/T7', STAGE],
    ['слишком длинный заголовок', `feat(sim): ${'добавлено '.repeat(8)}\n\nЭтап: 02/T7`, STAGE],
  ])('отклоняет: %s', (_name, message, ctx) => {
    expect(checkCommitMessage(message, ctx).length).toBeGreaterThan(0);
  });

  it('не требует трейлер «Этап:» вне веток этапов', () => {
    expect(checkCommitMessage('docs(docs): уточнён формат карты', MAIN)).toEqual([]);
  });
});
