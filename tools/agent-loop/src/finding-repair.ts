// Возврат reviewer: машинный протокол repair-spec, проверка результата и защита от повторов.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  backoff,
  checkPermissions,
  park,
  save,
  session,
  type LoopContext,
  type Step,
} from './context.ts';
import { changedPaths, dirtyFiles, head, remoteHead } from './git.ts';
import { runPlan } from './plan.ts';
import { runReview, type ReviewFinding } from './review.ts';

/** Объединяет все замечания одной роли в один рабочий заход, сохраняя порядок ролей review. */
export function batchReviewFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  const emitted = new Set<ReviewFinding['kind']>();
  return findings.flatMap((finding) => {
    if (finding.kind === 'ПЛАН') return [finding];
    if (emitted.has(finding.kind)) return [];
    emitted.add(finding.kind);
    const sameRole = findings.filter(
      (candidate, index) =>
        candidate.kind === finding.kind &&
        findings.findIndex(
          (other) => other.kind === candidate.kind && other.text === candidate.text,
        ) === index,
    );
    if (!sameRole.includes(finding)) return [];
    if (sameRole.length === 1) return [finding];
    return [
      {
        kind: finding.kind,
        text: sameRole.map((candidate, index) => `${index + 1}. ${candidate.text}`).join('\n'),
      },
    ];
  });
}

export const findingPrompt = (task: string, finding: ReviewFinding): string =>
  [
    finding.kind === 'ТЕСТ' ? `$spec ${task}` : `$task ${task}`,
    finding.text.startsWith('ПЕРЕДЕЛАТЬ:')
      ? 'Это не точечный патч: план решил, что механизм (или подход теста к нему) нужно ' +
        'переписать целиком одним согласованным решением, потому что подряд несколько точечных ' +
        'патчей не закрыли задачу по существу. Не добавляй ещё один частный костыль поверх ' +
        'старых — замени сам подход, сохранив приёмку задачи.'
      : 'Исправь весь переданный пакет замечаний одной роли за один согласованный проход:',
    finding.text,
    ...(finding.kind === 'ТЕСТ'
      ? [
          'Пункт reviewer не меняет источник истины. Сначала сверь его с задачей, родителем и GDD. ' +
            'Если пункт требует противоположного поведения, тесты не меняй и назови критерий в ответе.',
          'Сообщи, какие тесты изменены и как они проходят. Исход определит оркестратор по реальному прогону тестов и независимому review.',
        ]
      : []),
    'Создай локальный атомарный коммит. Не меняй отметку задачи, STATUS и не push.',
  ].join('\n');

const SPEC_PATHS_RE = /^СПЕК:\s*(.+)\s*$/imu;
const TEST_CASE_RE = /\b(?:it|test)(?:\.(?:each|only|skip|todo))?\s*\(/gu;

/**
 * Разрешает заменить целиком только один явно отклонённый сценарий. Иначе удаление файла может
 * незаметно унести независимую регрессию, которую новый тест не обязан повторять.
 */
async function isSafeSingleTestReplacement(
  context: LoopContext,
  finding: ReviewFinding,
  message: string,
  saved: Readonly<Record<string, string>>,
  deletedPath: string,
): Promise<boolean> {
  if (!finding.text.includes(deletedPath)) return false;
  const previous = saved[deletedPath];
  if (previous === undefined || (previous.match(TEST_CASE_RE) ?? []).length !== 1) return false;
  const replacements = SPEC_PATHS_RE.exec(message)?.[1]
    ?.split(',')
    .map((path) => path.trim())
    .filter((path) => path !== deletedPath && /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path));
  if (replacements === undefined || replacements.length === 0) return false;
  for (const path of replacements) {
    const text = await readFile(join(context.config.root, path), 'utf8').catch(() => undefined);
    if (text !== undefined) return true;
  }
  return false;
}

export async function diagnoseFinding(
  context: LoopContext,
  task: string,
  finding: ReviewFinding,
  retryOnce = false,
  question?: string,
): Promise<Step> {
  const planned = await runPlan(
    context,
    task,
    question ??
      `Диагностика возврата reviewer: «${finding.text}». Проверь, выполним ли критерий в разрешённой тестовой среде. Технический конфликт тестового слоя не требует решения владельца: выбери разрешённый слой по docs/testing.md и верни PLAN: инфраструктура. Вопрос запиши только при недостающем продуктовом решении; не заставляй тест имитировать результат проверяемого механизма.`,
  );
  if (typeof planned === 'string') return planned;
  if (planned.blocked)
    return park(
      context,
      `plan:${task}`,
      `${task}: критерий требует решения владельца после диагностики plan`,
    );
  const active = context.state.activeTask;
  if (planned.outcome === 'инфраструктура') {
    if (active !== undefined) {
      const kind = finding.kind === 'ТЕСТ' ? 'ТЕСТ' : 'КОД';
      active.findings[0] = {
        kind,
        text: `${kind}: устранить технический блокер без участия владельца — ${planned.detail}`,
      };
      active.findingRetries = 0;
      active.phase = 'work';
      await save(context);
    }
    await context.say(`${task}: технический блокер передан исполнителю, владелец не требуется`);
    return 'worked';
  }
  if (planned.outcome === 'переделать') {
    if (active !== undefined) {
      // ТЕСТ-пункт переделывается автором тестов ($spec), а не кодером: иначе редизайн того,
      // что сломалось в тестах, уедет роли, которая к тестам не имеет доступа по правам.
      const kind = finding.kind === 'ТЕСТ' ? 'ТЕСТ' : 'ПЕРЕДЕЛАТЬ';
      active.findings[0] = { kind, text: `ПЕРЕДЕЛАТЬ: ${planned.detail}` };
      active.findingRetries = 0;
      delete active.fixStreak;
      delete active.fullReviewRounds;
      active.phase = 'work';
      await save(context);
    }
    await context.say(`${task}: plan решил переделать механизм целиком — ${planned.detail}`);
    return 'worked';
  }
  if (planned.outcome === 'уточнено' || planned.outcome === 'разбито') {
    if (active !== undefined) {
      active.findings = [];
      active.findingRetries = 0;
      active.phase = 'review';
      await save(context);
    }
    return 'worked';
  }
  if (retryOnce) {
    if (active !== undefined) {
      active.findings[0] = finding;
      active.phase = 'work';
      await save(context);
    }
    await context.say(
      `${task}: plan не нашёл конфликт требований, даю исправляющей роли последнюю попытку`,
    );
    return 'worked';
  }
  if (finding.kind === 'ТЕСТ' && active !== undefined && active.planTestRetryUsed !== true) {
    active.findings[0] = finding;
    active.planTestRetryUsed = true;
    active.specBounceStreak = 0;
    active.phase = 'work';
    await save(context);
    await context.say(`${task}: plan подтвердил тестовый путь — даю $spec последнюю попытку`);
    return 'worked';
  }
  return park(
    context,
    `repeat:${task}`,
    `${task}: plan не изменил повторно отклонённый пункт; автоматический повтор той же роли запрещён`,
  );
}

const changedPathsBetween = async (context: LoopContext, base: string): Promise<string[]> =>
  (await context.git.run(['diff', '--name-only', `${base}..HEAD`]))
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);

const normalize = (text: string): string => text.replace(/\r\n/gu, '\n').trimEnd();

/** Незакоммиченными остались только исходные приёмочные тесты в сохранённом виде. */
async function onlySavedSpecDirty(
  context: LoopContext,
  task: string,
  checkContent = true,
): Promise<boolean> {
  const paths = await changedPaths(context.git);
  const saved = context.state.spec[task];
  if (paths.length === 0 || saved === undefined) return false;
  for (const path of paths) {
    const expected = saved[path];
    if (expected === undefined) return false;
    if (!checkContent) continue;
    const current = await readFile(join(context.config.root, path), 'utf8').catch(() => undefined);
    if (current === undefined || normalize(current) !== normalize(expected)) return false;
  }
  return true;
}

/** Хвост ошибки verify для повторного промпта $spec: без шума, но с конкретной строкой TS/assert. */
const verifyFailureSummary = (stdout: string, stderr: string): string =>
  [stdout, stderr]
    .filter(Boolean)
    .join('\n')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /error|FAIL|AssertionError|Expected|Received/iu.test(line))
    .slice(-8)
    .join('\n');

const E2E_SPEC_RE = /^apps\/client\/tests\/e2e\/.*\.spec\.ts$/u;

/** @returns ошибки всех изменённых тестов; undefined — все зелёные. */
async function verifyTouchedTests(
  context: LoopContext,
  touched: readonly string[],
): Promise<string | undefined> {
  const specs = touched.filter((path) => E2E_SPEC_RE.test(path));
  const failures: string[] = [];
  if (specs.length > 0) {
    const e2e = await context.config.runCommand('pnpm', ['test:e2e:layout', ...specs], {
      cwd: context.config.root,
      timeoutMs: context.config.maxMinutes * 60_000,
    });
    if (e2e.code !== 0)
      failures.push(`Playwright: ${verifyFailureSummary(e2e.stdout, e2e.stderr)}`);
  }
  const unit = touched.filter(
    (path) => !E2E_SPEC_RE.test(path) && /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path),
  );
  if (unit.length > 0) {
    const tested = await context.config.runCommand('pnpm', ['exec', 'vitest', 'run', ...unit], {
      cwd: context.config.root,
      timeoutMs: context.config.maxMinutes * 60_000,
    });
    if (tested.code !== 0)
      failures.push(`Vitest: ${verifyFailureSummary(tested.stdout, tested.stderr)}`);
  }
  if (specs.length + unit.length !== touched.length) {
    const verified = await context.config.runCommand('pnpm', ['verify', '--changed'], {
      cwd: context.config.root,
      timeoutMs: context.config.maxMinutes * 60_000,
    });
    if (verified.code !== 0)
      failures.push(`verify: ${verifyFailureSummary(verified.stdout, verified.stderr)}`);
  }
  return failures.length === 0 ? undefined : failures.join('\n');
}

/** Красный тест классифицирует независимый reviewer; ответ автора теста не управляет переходом. */
async function classifyRedTests(
  context: LoopContext,
  task: string,
  finding: ReviewFinding,
  failure: string,
): Promise<Step> {
  const verdict = await runReview(
    context,
    task,
    `Узкая классификация: целевые тесты после ремонта красные:\n${failure}\n` +
      `Классифицируй каждую причину: ошибка локатора/фикстуры/ожидания — ТЕСТ, ` +
      `отсутствующий продуктовый механизм — КОД, непроверяемый критерий — ПЛАН. ` +
      `Верни конкретные пункты, не отвечай OK при красном тесте. Исходный пункт: ${finding.text}`,
  );
  if (typeof verdict === 'string') return verdict;
  if (verdict.ok)
    return park(
      context,
      `test-classification:${task}`,
      `${task}: красный тест reviewer не классифицировал`,
      failure,
    );
  const active = context.state.activeTask;
  if (active !== undefined) {
    const testFindings = verdict.findings.filter((item) => item.kind === 'ТЕСТ');
    const otherFindings = verdict.findings.filter((item) => item.kind !== 'ТЕСТ');
    active.findings = batchReviewFindings([
      ...testFindings,
      ...otherFindings,
      ...active.findings.slice(1),
    ]);
    active.findingRetries = 0;
    active.phase = 'work';
    await save(context);
  }
  await context.say(
    `${task}: красные тесты распределены по ролям: ${active?.findings.map((item) => item.kind).join(', ') ?? ''}`,
  );
  return 'worked';
}

export async function runTestFix(
  context: LoopContext,
  task: string,
  finding: ReviewFinding,
  /** Вторая попытка после своего же красного verify --changed; третья запрещена. */
  attempt = 1,
  /** До первой попытки в дереве уже лежали красные приёмочные тесты текущей задачи. */
  pendingSpec = false,
): Promise<Step | undefined> {
  const hadPendingSpec = pendingSpec || (await onlySavedSpecDirty(context, task, false));
  const base = await head(context.git);
  const published = await remoteHead(context.git);
  const result = await session(context, 'spec', findingPrompt(task, finding));
  if (result.failure !== undefined)
    return backoff(context, `$spec ${task}: ${result.failure}`, result.message);
  if ((await remoteHead(context.git)) !== published)
    return park(context, `push:${task}`, `${task}: $spec изменила origin до review`);
  const committed = (await head(context.git)) !== base;
  const expectedDirty = committed && hadPendingSpec && (await onlySavedSpecDirty(context, task));
  if ((await dirtyFiles(context.git)) !== '' && !expectedDirty) {
    // Содержимое уже прошло verify --changed в хуке конца хода сессии (AGENTS.md §0) — не хватает
    // только `git commit`. 30-минутный backoff для этого бессмысленен: это не сбой инфраструктуры,
    // а забытый шаг в том же ответе, который повторная попытка сразу же может исправить.
    if (attempt < 2) {
      await context.say(`$spec ${task}: написал правку, но не закоммитил — даю вторую попытку`);
      return runTestFix(
        context,
        task,
        {
          ...finding,
          text: `${finding.text}\nПредыдущая попытка написала правку, но не создала git commit — не забудь закоммитить.`,
        },
        attempt + 1,
        hadPendingSpec,
      );
    }
    return park(
      context,
      `spec:${task}`,
      `${task}: $spec второй раз подряд не коммитит свою правку — проверь`,
      result.message,
    );
  }
  if (!committed) {
    const failure = await verifyTouchedTests(context, Object.keys(context.state.spec[task] ?? {}));
    if (failure !== undefined) return classifyRedTests(context, task, finding, failure);
    return undefined;
  }
  if (!(await checkPermissions(context, base, context.definitions.specPaths)))
    return park(context, `spec:${task}`, `$spec ${task} изменил файлы вне тестов`, result.message);
  let saved = { ...(context.state.spec[task] ?? {}) };
  const touched = await changedPathsBetween(context, base);
  const verifiedPaths: string[] = [];
  for (const path of touched) {
    // Автор тестов не может удалить чужую проверку (AGENTS.md §4.5); чтение несуществующего
    // файла раньше падало необработанным ENOENT и обрывало весь цикл.
    const text = await readFile(join(context.config.root, path), 'utf8').catch(() => undefined);
    if (
      text === undefined &&
      (await isSafeSingleTestReplacement(context, finding, result.message, saved, path))
    ) {
      saved = Object.fromEntries(Object.entries(saved).filter(([savedPath]) => savedPath !== path));
      await context.say(`repair-$spec ${task}: заменил единственный отклонённый тест ${path}`);
      continue;
    }
    if (text === undefined)
      return park(
        context,
        `spec:${task}`,
        `$spec ${task} удалил ${path} — проверь`,
        result.message,
      );
    saved[path] = text;
    verifiedPaths.push(path);
  }
  context.state.spec[task] = saved;
  await save(context);
  const failure = await verifyTouchedTests(context, verifiedPaths);
  if (failure !== undefined) return classifyRedTests(context, task, finding, failure);
  return undefined;
}
