// Возврат reviewer: единый пакет исполнителю, диагностика plan и проверки задачи.
import { park, save, type LoopContext, type Step } from './context.ts';
import { runPlan } from './plan.ts';
import type { ReviewFinding } from './review.ts';

/** Собирает замечания к коду и тестам в один проход исполнителя; решение plan остаётся отдельным. */
export function batchReviewFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  const actionable = findings.filter((finding) => finding.kind !== 'ПЛАН');
  const unique = actionable.filter(
    (finding, index) =>
      actionable.findIndex(
        (other) => other.kind === finding.kind && other.text === finding.text,
      ) === index,
  );
  const work =
    unique.length === 0
      ? []
      : [
          {
            kind: 'КОД' as const,
            text: unique
              .map((item, index) =>
                unique.length === 1 ? item.text : `${index + 1}. ${item.text}`,
              )
              .join('\n'),
          },
        ];
  return [...findings.filter((finding) => finding.kind === 'ПЛАН'), ...work];
}

export const findingPrompt = (task: string, finding: ReviewFinding): string =>
  [
    `$task ${task}`,
    finding.text.startsWith('ПЕРЕДЕЛАТЬ:')
      ? 'Это не точечный патч: план решил, что механизм (или подход теста к нему) нужно ' +
        'переписать целиком одним согласованным решением, потому что подряд несколько точечных ' +
        'патчей не закрыли задачу по существу. Не добавляй ещё один частный костыль поверх ' +
        'старых — замени сам подход, сохранив приёмку задачи.'
      : 'Исправь весь пакет замечаний к продукту и тестам одним согласованным проходом:',
    finding.text,
    'Сверь ожидания тестов с задачей и реальным состоянием приложения. Ошибку подготовки теста ' +
      'исправь в тесте; отсутствие механизма — в продукте. Не удаляй чужие регрессии.',
    'Создай локальный атомарный коммит. Не меняй отметку задачи, STATUS и не push.',
  ].join('\n');

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
      active.findings[0] = { kind: 'ПЕРЕДЕЛАТЬ', text: `ПЕРЕДЕЛАТЬ: ${planned.detail}` };
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

/** Хвост ошибки проверки: без шума, но с конкретной строкой TS/assert. */
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

/** @returns ошибки всех тестов задачи и рабочего verify; undefined — все зелёные. */
export async function verifyTouchedTests(
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
  const verified = await context.config.runCommand('pnpm', ['verify', '--changed'], {
    cwd: context.config.root,
    timeoutMs: context.config.maxMinutes * 60_000,
  });
  if (verified.code !== 0)
    failures.push(`verify: ${verifyFailureSummary(verified.stdout, verified.stderr)}`);
  return failures.length === 0 ? undefined : failures.join('\n');
}
