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
    finding.kind === 'КОД' ? `$task ${task}` : `$spec ${task}`,
    'Исправь ровно один пункт reviewer; остальные пункты этой задачи тебе не переданы:',
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
): Promise<Step> {
  const planned = await runPlan(
    context,
    task,
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

export async function runTestFix(
  context: LoopContext,
  task: string,
  finding: ReviewFinding,
): Promise<Step | 'rerouted' | undefined> {
  const base = await head(context.git);
  const published = await remoteHead(context.git);
  const result = await session(context, 'spec', findingPrompt(task, finding));
  if (result.failure !== undefined)
    return backoff(context, `$spec ${task}: ${result.failure}`, result.message);
  if ((await remoteHead(context.git)) !== published)
    return park(context, `push:${task}`, `${task}: $spec изменила origin до review`);
  if ((await dirtyFiles(context.git)) !== '')
    return backoff(context, `$spec ${task} оставил незакоммиченные файлы`, result.message);
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
  for (const path of await changedPathsBetween(context, base))
    saved[path] = await readFile(join(context.config.root, path), 'utf8');
  context.state.spec[task] = saved;
  await save(context);
  if (outcome.kind === 'code') return rerouteToCode(context, outcome.detail);
  if (outcome.kind === 'untestable')
    return park(
      context,
      `spec:${task}`,
      `$spec ${task} изменил тесты, хотя сообщил о непроверяемом критерии; нужен ручной разбор`,
      result.message,
    );
  const verified = await context.config.runCommand('pnpm', ['verify', '--changed'], {
    cwd: context.config.root,
    timeoutMs: context.config.maxMinutes * 60_000,
  });
  if (verified.code !== 0)
    return park(
      context,
      `test-fix:${task}`,
      `${task}: repair-$spec оставил красный verify --changed; повтор и review запрещены`,
      `${verified.stdout}\n${verified.stderr}`,
    );
  return undefined;
}

async function rerouteToCode(context: LoopContext, detail: string): Promise<'rerouted'> {
  const active = context.state.activeTask;
  if (active !== undefined) active.findings[0] = { kind: 'КОД', text: `КОД: ${detail}` };
  await save(context);
  return 'rerouted';
}
