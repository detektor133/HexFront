// Разбор красной локальной приёмки перед push: какие проверки упали, чьи они и как их воспроизвести.
// Прежний краткий хвост вывода не называл файл теста, и исполнитель отвечал «уже сделано».

const E2E_RE = /tests[\\/]e2e[\\/]([\w.-]+\.spec\.ts)/gu;
const UNIT_RE =
  /(?:\|[\w-]+\|\s+|\b)((?:apps|packages|tools)[\\/][\w-]+[\\/]test[\\/][\w./-]+?\.test\.tsx?|test[\\/][\w./-]+?\.test\.tsx?)/gu;

export interface FailedChecks {
  /** Playwright-спеки в `apps/client/tests/e2e`. */
  readonly e2e: readonly string[];
  /** Файлы Vitest в виде, как их напечатал вывод. */
  readonly unit: readonly string[];
}

const unique = (items: Iterable<string>): string[] => [...new Set(items)].sort();

/** @returns упавшие спеки и тесты, названные в выводе красной приёмки. */
export function failedChecks(output: string): FailedChecks {
  const failedLines = output
    .split(/\r?\n/gu)
    .filter((line) => /(?:\bFAIL\b|\bfailed\b|^\s*\d+\)\s|^\s*x\s|✘|×|❯)/iu.test(line));
  const text = failedLines.join('\n');
  return {
    e2e: unique([...text.matchAll(E2E_RE)].map((match) => `apps/client/tests/e2e/${match[1]}`)),
    unit: unique(
      [...text.matchAll(UNIT_RE)].map((match) => (match[1] ?? '').replaceAll('\\', '/')),
    ),
  };
}

/** Ключ неизменности провала: одни и те же упавшие проверки подряд. */
export const failureKey = (checks: FailedChecks): string =>
  [...checks.e2e, ...checks.unit].join('|');

export interface PrePushFinding {
  readonly text: string;
  readonly key: string;
}

/**
 * Замечание исполнителю по красной приёмке. Называет упавшие файлы, команду воспроизведения и
 * говорит, меняла ли их задача: если нет, изменение продукта нарушило допущение чужой проверки.
 * @param summary краткие сигналы из вывода (хвост ошибок)
 * @param touched файлы, изменённые задачей относительно её базы
 * @param repeat сколько раз подряд приёмка падала на тех же проверках до этого раза
 */
export function prePushFinding(
  summary: string,
  checks: FailedChecks,
  touched: readonly string[],
  repeat: number,
): PrePushFinding {
  const key = failureKey(checks);
  const files = [...checks.e2e, ...checks.unit];
  const foreign = files.filter(
    (file) => !touched.some((path) => path.endsWith(file.replace(/^.*[\\/]/u, ''))),
  );
  const parts = ['КОД: локальная приёмка перед push красная.'];
  if (files.length > 0) parts.push(`Упавшие проверки: ${files.join(', ')}.`);
  if (checks.e2e.length > 0)
    parts.push(
      `Воспроизведи: pnpm test:e2e:layout ${checks.e2e.join(' ')} (тот же Playwright, что в приёмке).`,
    );
  if (foreign.length > 0)
    parts.push(
      `Эти проверки задача не меняла (${foreign.join(', ')}), на базе они зелёные: изменение продукта ` +
        'нарушило их допущение (структура DOM, порядок элементов, размер). Приведи продукт к тому, ' +
        'на что рассчитана проверка, а если допущение устарело по критерию этой задачи — обнови проверку, ' +
        'не ослабляя её и сохраняя смысл.',
    );
  if (repeat > 0)
    parts.push(
      `Это ${repeat + 1}-й подряд провал тех же проверок, предыдущий ответ не изменил результат. ` +
        'Не отвечай «уже сделано»: запусти команду воспроизведения, приведи фактическое расхождение ' +
        '(ожидание и получено) и исправь его коммитом.',
    );
  parts.push(`Сигналы вывода: ${summary}`);
  return { text: parts.join(' '), key };
}
