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

  describe('трейлер «Этап: NN» без задачи (только docs/)', () => {
    const DOCS = { branch: 'stage-04', files: ['docs/STATUS.md', 'docs/gdd/07-controls.md'] };
    const CODE = { branch: 'stage-04', files: ['docs/STATUS.md', 'packages/sim/src/step.ts'] };

    it.each([
      ['docs(docs)', 'docs(docs): уточнён статус\n\nЭтап: 04'],
      ['change(docs)', 'change(docs): правило фронта\n\nЭтап: 04\nРешение: DECISIONS 2026-09-27'],
    ])('разрешён для %s, меняющего только docs/', (_name, message) => {
      expect(checkCommitMessage(message, DOCS)).toEqual([]);
    });

    it.each([
      ['коммит задевает код', 'docs(docs): уточнён статус\n\nЭтап: 04', CODE],
      ['тип не docs', 'feat(sim): добавлена система\n\nЭтап: 04', DOCS],
      ['change с другой областью', 'change(sim): правило\n\nЭтап: 04\nРешение: DECISIONS', DOCS],
      [
        'список файлов неизвестен',
        'docs(docs): уточнён статус\n\nЭтап: 04',
        { branch: 'stage-04' },
      ],
    ])('не разрешён: %s', (_name, message, ctx) => {
      expect(checkCommitMessage(message, ctx)).toContain(
        'в ветке этапа нужен трейлер «Этап: NN/Tn»',
      );
    });
  });

  it('сгенерированные токены клиента — часть коммита документов', () => {
    const files = [
      'docs/art/tokens.json',
      'apps/client/src/theme/tokens.css',
      'apps/client/src/theme/tokens.ts',
    ];
    const message =
      'change(docs): токены потока снабжения удалены\n\nЭтап: 04\nРешение: DECISIONS 2026-09-27';
    expect(checkCommitMessage(message, { branch: 'stage-04', files })).toEqual([]);
    const other = [...files, 'apps/client/src/theme/colors.ts'];
    expect(checkCommitMessage(message, { branch: 'stage-04', files: other })).toContain(
      'в ветке этапа нужен трейлер «Этап: NN/Tn»',
    );
  });

  describe('исключения по хэшу', () => {
    const MESSAGE = 'docs(docs): CR-006 «Автокомандование»\n\nЭтап: 04';
    const FILES = ['docs/changes/CR-006-auto-command.md'];

    it('коммит из списка исключений проходит с заглавной буквы в заголовке', () => {
      const sha = '2d2edc8272cf3d4c058fbff2459d46ed52f3a7bb';
      expect(checkCommitMessage(MESSAGE, { branch: 'stage-04', files: FILES, sha })).toEqual([]);
    });

    it('другой коммит с заглавной буквой по-прежнему отклоняется', () => {
      const sha = '0000000000000000000000000000000000000000';
      expect(checkCommitMessage(MESSAGE, { branch: 'stage-04', files: FILES, sha })).toEqual([
        'текст заголовка — с маленькой буквы',
      ]);
    });

    it('исключение снимает только правило регистра', () => {
      const sha = '2d2edc8272cf3d4c058fbff2459d46ed52f3a7bb';
      const errors = checkCommitMessage('docs(docs): CR-006 «Автокомандование».', {
        branch: 'stage-04',
        files: FILES,
        sha,
      });
      expect(errors).toContain('точка в конце заголовка');
      expect(errors).toContain('в ветке этапа нужен трейлер «Этап: NN/Tn»');
    });
  });

  it('номер задачи с буквой, как в этапе (T2a)', () => {
    const message = 'feat(client): планы армий в песочнице\n\nЭтап: 04/T2a';
    expect(checkCommitMessage(message, { branch: 'stage-04' })).toEqual([]);
    expect(checkCommitMessage(message.replace('T2a', 'T2A'), { branch: 'stage-04' })).toContain(
      'в ветке этапа нужен трейлер «Этап: NN/Tn»',
    );
  });

  it('не требует трейлер «Этап:» вне веток этапов', () => {
    expect(checkCommitMessage('docs(docs): уточнён формат карты', MAIN)).toEqual([]);
  });
});
