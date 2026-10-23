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
import { dirtyFiles, head, remoteHead } from './git.ts';
import { runPlan } from './plan.ts';
import type { ReviewFinding } from './review.ts';

export const findingPrompt = (task: string, finding: ReviewFinding): string =>
  [
    finding.kind === 'ТЕСТ' ? `$spec ${task}` : `$task ${task}`,
    finding.text.startsWith('ПЕРЕДЕЛАТЬ:')
      ? 'Это не точечный патч: план решил, что механизм (или подход теста к нему) нужно ' +
        'переписать целиком одним согласованным решением, потому что подряд несколько точечных ' +
        'патчей не закрыли задачу по существу. Не добавляй ещё один частный костыль поверх ' +
        'старых — замени сам подход, сохранив приёмку задачи.'
      : 'Исправь ровно один пункт reviewer; остальные пункты этой задачи тебе не переданы:',
    finding.text,
    ...(finding.kind === 'ТЕСТ'
      ? [
          'Предпоследняя строка ответа: `РЕМОНТ: ИСПРАВЛЕНО`, `РЕМОНТ: КОД — <дефект продукта>` или `РЕМОНТ: НЕПРОВЕРЯЕМО — <причина>`.',
          '`ИСПРАВЛЕНО` допустимо только при зелёном целевом тесте; красный усиленный тест — `КОД`, невозможный в тестовой среде критерий — `НЕПРОВЕРЯЕМО`.',
        ]
      : []),
    'Создай локальный атомарный коммит. Не меняй отметку задачи, STATUS и не push.',
  ].join('\n');

type TestRepairOutcome =
  | { readonly kind: 'fixed' }
  | { readonly kind: 'code'; readonly detail: string }
  | { readonly kind: 'untestable'; readonly detail: string };

const TEST_REPAIR_RE = /^РЕМОНТ:\s*(ИСПРАВЛЕНО|КОД|НЕПРОВЕРЯЕМО)(?:\s*[—-]\s*(.+))?\s*$/imu;

export function parseTestRepair(message: string): TestRepairOutcome | undefined {
  const match = TEST_REPAIR_RE.exec(message);
  if (!match) return undefined;
  if (match[1] === 'ИСПРАВЛЕНО') return { kind: 'fixed' };
  const detail = match[2]?.trim();
  if (!detail) return undefined;
  return match[1] === 'КОД' ? { kind: 'code', detail } : { kind: 'untestable', detail };
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
      `Диагностика возврата reviewer: «${finding.text}». Проверь, выполним ли критерий в разрешённой тестовой среде. Если нет — запиши вопрос; не заставляй тест имитировать результат проверяемого механизма.`,
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
      active.findings[0] = {
        kind: 'КОД',
        text: `КОД: устранить технический блокер без участия владельца — ${planned.detail}`,
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

/**
 * Не верит вердикту `НЕПРОВЕРЯЕМО` на слово (2026-10-23, 07/T17as: $spec заявил, что Playwright
 * запрещён правилами проекта — неверно, п.10 его же скилла прямо разрешает `test:e2e:layout`;
 * тест при этом был красным по существу). Реально прогоняет изменённые тесты сам.
 * @returns хвост ошибки, если изменённые тесты красные; undefined — все зелёные.
 */
async function verifyTouchedTests(
  context: LoopContext,
  touched: readonly string[],
): Promise<string | undefined> {
  const specs = touched.filter((path) => E2E_SPEC_RE.test(path));
  if (specs.length > 0) {
    const e2e = await context.config.runCommand('pnpm', ['test:e2e:layout', ...specs], {
      cwd: context.config.root,
      timeoutMs: context.config.maxMinutes * 60_000,
    });
    if (e2e.code !== 0) return verifyFailureSummary(e2e.stdout, e2e.stderr);
  }
  const verified = await context.config.runCommand('pnpm', ['verify', '--changed'], {
    cwd: context.config.root,
    timeoutMs: context.config.maxMinutes * 60_000,
  });
  return verified.code === 0 ? undefined : verifyFailureSummary(verified.stdout, verified.stderr);
}

export async function runTestFix(
  context: LoopContext,
  task: string,
  finding: ReviewFinding,
  /** Вторая попытка после своего же красного verify --changed; третья запрещена. */
  attempt = 1,
): Promise<Step | 'rerouted' | undefined> {
  const base = await head(context.git);
  const published = await remoteHead(context.git);
  const result = await session(context, 'spec', findingPrompt(task, finding));
  if (result.failure !== undefined)
    return backoff(context, `$spec ${task}: ${result.failure}`, result.message);
  if ((await remoteHead(context.git)) !== published)
    return park(context, `push:${task}`, `${task}: $spec изменила origin до review`);
  if ((await dirtyFiles(context.git)) !== '') {
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
      );
    }
    return park(
      context,
      `spec:${task}`,
      `${task}: $spec второй раз подряд не коммитит свою правку — проверь`,
      result.message,
    );
  }
  const outcome = parseTestRepair(result.message);
  if (outcome === undefined)
    return park(
      context,
      `spec-protocol:${task}`,
      `$spec ${task} не указал машинный исход РЕМОНТ; повтор автоматически запрещён`,
      result.message,
    );
  if ((await head(context.git)) === base) {
    if (outcome.kind === 'untestable') return diagnoseFinding(context, task, finding);
    if (outcome.kind === 'code') return rerouteToCode(context, outcome.detail);
    return park(context, `spec:${task}`, `$spec ${task} сообщил об исправлении без коммита`);
  }
  if (!(await checkPermissions(context, base, context.definitions.specPaths)))
    return park(context, `spec:${task}`, `$spec ${task} изменил файлы вне тестов`, result.message);
  const saved = { ...(context.state.spec[task] ?? {}) };
  const touched = await changedPathsBetween(context, base);
  for (const path of touched) {
    // Автор тестов не может удалить чужую проверку (AGENTS.md §4.5); чтение несуществующего
    // файла раньше падало необработанным ENOENT и обрывало весь цикл.
    const text = await readFile(join(context.config.root, path), 'utf8').catch(() => undefined);
    if (text === undefined)
      return park(
        context,
        `spec:${task}`,
        `$spec ${task} удалил ${path} — проверь`,
        result.message,
      );
    saved[path] = text;
  }
  context.state.spec[task] = saved;
  await save(context);
  if (outcome.kind === 'code') return rerouteToCode(context, outcome.detail);
  if (outcome.kind === 'untestable') {
    // Не верим вердикту на слово: реально прогоняем изменённые тесты сами же себе (2026-10-23,
    // 07/T17as — заявил «Playwright запрещён правилами проекта», хотя это неверно и сам тест был
    // красным по существу).
    const failure = await verifyTouchedTests(context, touched);
    if (failure === undefined) return undefined;
    if (attempt < 2) {
      await context.say(
        `repair-$spec ${task}: заявил НЕПРОВЕРЯЕМО, но изменённый тест красный — даю вторую попытку`,
      );
      return runTestFix(
        context,
        task,
        {
          ...finding,
          text:
            `${finding.text}\nПредыдущая попытка заявила РЕМОНТ: НЕПРОВЕРЯЕМО, но реальный ` +
            `прогон изменённых тестов красный:\n${failure}`,
        },
        attempt + 1,
      );
    }
    return park(
      context,
      `spec:${task}`,
      `${task}: repair-$spec второй раз подряд заявил НЕПРОВЕРЯЕМО при красном изменённом тесте`,
      failure,
    );
  }
  const verified = await context.config.runCommand('pnpm', ['verify', '--changed'], {
    cwd: context.config.root,
    timeoutMs: context.config.maxMinutes * 60_000,
  });
  if (verified.code !== 0) {
    if (attempt < 2) {
      await context.say(
        `repair-$spec ${task}: заявил ИСПРАВЛЕНО, но verify --changed красный — даю вторую попытку`,
      );
      return runTestFix(
        context,
        task,
        {
          ...finding,
          text:
            `${finding.text}\nПредыдущая попытка заявила РЕМОНТ: ИСПРАВЛЕНО, но ` +
            `pnpm verify --changed оказался красным:\n${verifyFailureSummary(verified.stdout, verified.stderr)}`,
        },
        attempt + 1,
      );
    }
    return park(
      context,
      `test-fix:${task}`,
      `${task}: repair-$spec второй раз подряд оставил красный verify --changed; повтор и review запрещены`,
      `${verified.stdout}\n${verified.stderr}`,
    );
  }
  return undefined;
}

async function rerouteToCode(context: LoopContext, detail: string): Promise<'rerouted'> {
  const active = context.state.activeTask;
  if (active !== undefined) active.findings[0] = { kind: 'КОД', text: `КОД: ${detail}` };
  await save(context);
  return 'rerouted';
}
