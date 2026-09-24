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
const STAGE_TRAILER_RE = /^Этап: \d{2}\/T\d+$/m;
const DECISION_TRAILER_RE = /^Решение: \S.*$/m;
const CYRILLIC_RE = /[а-яё]/i;
const TYPES_NEEDING_DECISION = new Set<string>(['balance', 'change']);

export interface CheckContext {
  /** Имя ветки, в которую попадает коммит; для `stage-*` обязателен трейлер «Этап:». */
  readonly branch: string;
}

/** Возвращает список нарушений; пустой список — сообщение корректно. */
export function checkCommitMessage(message: string, ctx: CheckContext): string[] {
  const lines = message.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const header = lines[0] ?? '';
  const errors: string[] = [];

  const match = HEADER_RE.exec(header);
  if (!match) {
    return [`заголовок не в формате «<тип>(<область>): <текст>»: «${header}»`];
  }
  const [, type = '', scope = '', text = ''] = match;

  if (!(TYPES as readonly string[]).includes(type)) errors.push(`неизвестный тип «${type}»`);
  if (!(SCOPES as readonly string[]).includes(scope)) errors.push(`неизвестная область «${scope}»`);
  if (header.length > HEADER_MAX) errors.push(`заголовок длиннее ${HEADER_MAX} символов`);
  if (!CYRILLIC_RE.test(text)) errors.push('текст заголовка должен быть по-русски');
  if (text[0] !== text[0]?.toLowerCase()) errors.push('текст заголовка — с маленькой буквы');
  if (text.endsWith('.')) errors.push('точка в конце заголовка');
  if (lines.length > 1 && lines[1] !== '') errors.push('после заголовка нужна пустая строка');

  lines.slice(1).forEach((line, i) => {
    if (line.length > BODY_LINE_MAX) {
      errors.push(`строка ${i + 2} длиннее ${BODY_LINE_MAX} символов`);
    }
  });

  if (ctx.branch.startsWith('stage-') && !STAGE_TRAILER_RE.test(message)) {
    errors.push('в ветке этапа нужен трейлер «Этап: NN/Tn»');
  }
  if (TYPES_NEEDING_DECISION.has(type) && !DECISION_TRAILER_RE.test(message)) {
    errors.push(`для типа «${type}» нужен трейлер «Решение:»`);
  }
  return errors;
}
