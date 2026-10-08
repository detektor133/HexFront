// Проверка сообщений коммитов по docs/CONVENTIONS.md §2 без сторонних зависимостей.

const TYPES = [
  'feat',
  'fix',
  'test',
  'refactor',
  'perf',
  'balance',
  'change',
  'docs',
  'build',
  'ci',
  'chore',
] as const;

const SCOPES = [
  'sim',
  'protocol',
  'mapgen',
  'client',
  'server',
  'bots',
  'balance-tool',
  'infra',
  'docs',
] as const;

const HEADER_MAX = 72;
const BODY_LINE_MAX = 100;
const HEADER_RE = /^([a-z]+)\(([a-z-]+)\): (.+)$/;
// Номер задачи — как в этапе: T7, T2a, T26b1; «infra» — инфраструктура вне задач этапа.
const STAGE_TRAILER_RE = /^Этап: \d{2}\/(T\d+[a-z0-9]*|infra)$/m;
/** «Этап: NN» без задачи — только для коммитов документов (docs или change(docs)), меняющих только docs/. */
const STAGE_ONLY_TRAILER_RE = /^Этап: \d{2}$/m;
const DECISION_TRAILER_RE = /^Решение: \S.*$/m;
const CYRILLIC_RE = /[а-яё]/i;
const TYPES_NEEDING_DECISION = new Set<string>(['balance', 'change']);
const GOLDEN_PATH_PREFIX = 'packages/sim/test/golden/';

/**
 * Запушенные коммиты, которые нельзя переписать: снимается только названное правило, остальные
 * проверяются как обычно.
 */
const EXCEPTIONS: ReadonlyMap<string, 'lowercase' | 'revert-header'> = new Map([
  // «docs(docs): CR-006 …» — заголовок начинается с номера CR заглавными буквами; коммит уже в
  // origin/stage-04, переписывать запушенную историю владелец запретил (DECISIONS 2026-09-27).
  ['2d2edc8272cf3d4c058fbff2459d46ed52f3a7bb', 'lowercase'],
  // Git создал эти заголовки при разрешении конфликтов последовательного revert владельца;
  // историю нельзя переписывать, поэтому для них разрешён только стандартный заголовок Revert.
  ['8b872fce34532a327dad677634aa182c8dcf34ed', 'revert-header'],
  ['9423893a82aeef5f4eb4a420fee5e8c596728c13', 'revert-header'],
  ['4a8e790edf0ebc1301d44d40bfffa01e4eee1cae', 'revert-header'],
  ['51d3e2bfa3b0c8130dc0c1acd681ba7da6001dca', 'revert-header'],
  ['897154d1078b8e3508c86f0bc14479db50800d4e', 'revert-header'],
]);

export interface CheckContext {
  /** Имя ветки, в которую попадает коммит; для `stage-*` обязателен трейлер «Этап:». */
  readonly branch: string;
  /** Файлы коммита; нужны, чтобы разрешить «Этап: NN» коммиту только документов. */
  readonly files?: readonly string[];
  /** Полный хэш коммита — для списка исключений. */
  readonly sha?: string;
}

/**
 * Файлы, сгенерированные из `docs/art/tokens.json` (`pnpm tokens`): CI требует коммитить их вместе
 * с токенами, поэтому они — часть коммита документов.
 */
const GENERATED_FROM_DOCS = new Set([
  'apps/client/src/theme/tokens.css',
  'apps/client/src/theme/tokens.ts',
]);

// Коммит документов этапа без задачи: тип docs или change(docs), все файлы — в docs/ или
// сгенерированы из них.
function isDocsOnly(type: string, scope: string, files: readonly string[] | undefined): boolean {
  const docsType = type === 'docs' || (type === 'change' && scope === 'docs');
  const docsFile = (f: string): boolean => f.startsWith('docs/') || GENERATED_FROM_DOCS.has(f);
  return docsType && !!files && files.length > 0 && files.every(docsFile);
}

/** Возвращает список нарушений; пустой список — сообщение корректно. */
export function checkCommitMessage(message: string, ctx: CheckContext): string[] {
  const lines = message.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const header = lines[0] ?? '';
  const errors: string[] = [];
  const exception = ctx.sha === undefined ? undefined : EXCEPTIONS.get(ctx.sha);

  if (exception === 'revert-header') return [];

  const match = HEADER_RE.exec(header);
  if (!match) {
    return [`заголовок не в формате «<тип>(<область>): <текст>»: «${header}»`];
  }
  const [, type = '', scope = '', text = ''] = match;

  if (!(TYPES as readonly string[]).includes(type)) errors.push(`неизвестный тип «${type}»`);
  if (!(SCOPES as readonly string[]).includes(scope)) errors.push(`неизвестная область «${scope}»`);
  if (header.length > HEADER_MAX) errors.push(`заголовок длиннее ${HEADER_MAX} символов`);
  if (!CYRILLIC_RE.test(text)) errors.push('текст заголовка должен быть по-русски');
  const lowercaseExempt = exception === 'lowercase';
  if (text[0] !== text[0]?.toLowerCase() && !lowercaseExempt) {
    errors.push('текст заголовка — с маленькой буквы');
  }
  if (text.endsWith('.')) errors.push('точка в конце заголовка');
  if (lines.length > 1 && lines[1] !== '') errors.push('после заголовка нужна пустая строка');

  lines.slice(1).forEach((line, i) => {
    if (line.length > BODY_LINE_MAX) {
      errors.push(`строка ${i + 2} длиннее ${BODY_LINE_MAX} символов`);
    }
  });

  const stageOk =
    STAGE_TRAILER_RE.test(message) ||
    (STAGE_ONLY_TRAILER_RE.test(message) && isDocsOnly(type, scope, ctx.files));
  if (ctx.branch.startsWith('stage-') && !stageOk) {
    errors.push('в ветке этапа нужен трейлер «Этап: NN/Tn»');
  }
  if (TYPES_NEEDING_DECISION.has(type) && !DECISION_TRAILER_RE.test(message)) {
    errors.push(`для типа «${type}» нужен трейлер «Решение:»`);
  }
  if (
    ctx.files?.some((file) => file.startsWith(GOLDEN_PATH_PREFIX)) &&
    !DECISION_TRAILER_RE.test(message)
  ) {
    errors.push('при изменении golden нужен трейлер «Решение:»');
  }
  return errors;
}
