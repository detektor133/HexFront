// Последовательный автомат задачи: код и тесты одним исполнителем → review → push → CI.
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  backoff,
  firstLine,
  lastLines,
  park,
  readStage,
  runSkill,
  save,
  session,
  waitCi,
  type CiResult,
  type LoopContext,
  type SkillResult,
  type Step,
} from './context.ts';
import {
  batchReviewFindings,
  diagnoseFinding,
  findingPrompt,
  testTimedOut,
  verifyTouchedTests,
} from './finding-repair.ts';
import { changedPaths, dirtyFiles, head, isAncestor, publishBranch, remoteHead } from './git.ts';
import { runPlan } from './plan.ts';
import { runReview, type ReviewFinding } from './review.ts';
import {
  forbiddenPaths,
  forbiddenWorkingPaths,
  isInfraTask,
  scopeViolation,
} from './scope-guard.ts';
import { forgetSpec } from './spec.ts';
import { commandTask, parseQueue, setTaskMark, taskBlock, taskMark } from './stage-file.ts';
import type { ActiveTask } from './state.ts';
import { runVisualGate } from './visual.ts';

export interface TaskRun {
  readonly step: Step;
  readonly done: boolean;
}

/** Подряд точечных патчей одного продуктового файла, после которых зовётся plan (не ещё патч). */
export const REDESIGN_STREAK = 2;
/** Подряд кругов финального review с новыми пунктами (любыми, не только по одному файлу/тесту). */
export const REVIEW_ROUND_LIMIT = 2;

/** Первый продуктовый (не тестовый) файл `apps/client/src` в списке изменённых путей коммита. */
export function dominantProductFile(paths: readonly string[]): string | undefined {
  return paths.find(
    (path) =>
      /^apps\/client\/src\//u.test(path) &&
      !/\.test\.[tj]sx?$/u.test(path) &&
      !/\/tests?\//u.test(path),
  );
}

/** Обновляет счётчик подряд патчей одного файла этим рабочим кругом; другой файл — сбрасывает его. */
export function updateFixStreak(active: ActiveTask, touched: readonly string[]): void {
  const file = dominantProductFile(touched);
  if (file === undefined) return;
  active.fixStreak =
    active.fixStreak?.file === file
      ? { file, count: active.fixStreak.count + 1 }
      : { file, count: 1 };
}

/** Упоминает ли пункт review файл текущей серии патчей (по имени файла, без пути). */
export function mentionsStreakFile(text: string, file: string): boolean {
  return text.includes(file) || text.includes(basename(file));
}

export const resumePrompt = (task: string): string => `$task ${task} продолжить`;
export const ciFixPrompt = (task: string, line: string): string =>
  `$task ${task} CI красный: ${line}`;

const checkFailureSignature = (evidence: string): string => {
  const lines = evidence
    .split(/\r?\n/u)
    .map((line) =>
      line
        .replaceAll('\u001b', '')
        .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s)\b/giu, '<время>')
        .trim(),
    )
    .filter((line) => /FAIL|\[warn\]|AssertionError|Error:|Expected|Received/iu.test(line));
  return (lines.length > 0 ? lines.join('\n') : evidence).slice(0, 1_000);
};

/** Форматирование — механическая правка, но только внутри уже принадлежащих задаче путей. */
async function formatOwnedWork(
  context: LoopContext,
  paths: readonly string[],
  evidence: string,
): Promise<boolean> {
  if (!/FAIL prettier/iu.test(evidence)) return false;
  const owned = new Set(context.state.activeTask?.workDirtyPaths ?? []);
  const eligible = [
    ...new Set(
      paths.filter(
        (path) =>
          owned.has(path) &&
          /\.(?:[cm]?[jt]sx?|json|css|md|html|ya?ml)$/iu.test(path) &&
          !/^apps\/client\/src\/theme\/tokens\./u.test(path),
      ),
    ),
  ];
  if (eligible.length === 0) return false;
  const formatted = await context.config.runCommand(
    'pnpm',
    ['exec', 'prettier', '--write', ...eligible],
    {
      cwd: context.config.root,
      timeoutMs: context.config.maxMinutes * 60_000,
    },
  );
  return formatted.code === 0;
}

/** После повторного зелёного прогона оркестратор сохраняет проверенную работу исполнителя. */
export async function commitVerifiedWork(
  context: Pick<LoopContext, 'git' | 'state' | 'say'>,
  task: string,
  paths: readonly string[],
): Promise<{ readonly kind: 'skipped' | 'committed' | 'failed'; readonly reason?: string }> {
  const active = context.state.activeTask;
  if (active?.task !== task || (active.workDirtyAttempts ?? 0) < 3) return { kind: 'skipped' };
  const owned = new Set(active.workDirtyPaths ?? []);
  const verified = new Set(active.verifiedDirtyPaths ?? []);
  if (paths.length === 0 || paths.some((path) => !owned.has(path)))
    return { kind: 'failed', reason: 'git commit: рабочие пути не совпали с путями задачи' };
  if (verified.size !== paths.length || paths.some((path) => !verified.has(path)))
    return { kind: 'skipped' };
  if (!isInfraTask(task) && forbiddenWorkingPaths(paths).length > 0)
    return { kind: 'failed', reason: 'git commit: работа затронула код агентного цикла' };
  const staged = (await context.git.run(['diff', '--cached', '--name-only']))
    .split(/\r?\n/u)
    .filter(Boolean);
  if (staged.some((path) => !owned.has(path)))
    return { kind: 'failed', reason: 'git commit: в индексе есть чужие файлы' };
  const scope = paths.some((path) => path.startsWith('apps/client/'))
    ? 'client'
    : paths.some((path) => path.startsWith('apps/server/'))
      ? 'server'
      : paths.some((path) => path.startsWith('packages/sim/'))
        ? 'sim'
        : paths.some((path) => path.startsWith('packages/protocol/'))
          ? 'protocol'
          : paths.some((path) => path.startsWith('packages/mapgen/'))
            ? 'mapgen'
            : 'infra';
  const added = await context.git.attempt(['add', '--', ...paths]);
  if (added.code !== 0)
    return { kind: 'failed', reason: `git add: ${added.stderr.trim() || 'неизвестная ошибка'}` };
  const committed = await context.git.attempt([
    'commit',
    '-m',
    `feat(${scope}): выполнена задача ${task}`,
    '-m',
    `Этап: ${task}`,
  ]);
  if (committed.code !== 0)
    return {
      kind: 'failed',
      reason: `git commit: ${committed.stderr.trim() || committed.stdout.trim() || 'неизвестная ошибка'}`,
    };
  if ((await dirtyFiles(context.git)) !== '')
    return { kind: 'failed', reason: 'git commit: после коммита остались изменённые файлы' };
  await context.say(`${task}: проверенная незакоммиченная работа сохранена оркестратором`);
  return { kind: 'committed' };
}

const prePushFailure = (stdout: string, stderr: string): string => {
  const output = [stdout, stderr].filter(Boolean).join('\n');
  const lines = output
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const signals = lines.filter((line) =>
    /(?:\bFAIL(?:ED)?\b|\bError\b|\berror\b|Expected|Received|^[+-]\s)/iu.test(line),
  );
  const summary = [...signals.slice(-8), ...lines.slice(-6)].filter(
    (line, index, all) => all.indexOf(line) === index,
  );
  return (summary.length > 0 ? summary.join(' | ') : lastLines(output, 12)).slice(0, 2_000);
};

export const skillFailed = (
  context: LoopContext,
  prompt: string,
  result: SkillResult & { ok: false },
): Promise<Step> => backoff(context, `${prompt}: ${result.reason}`, result.message);

async function followUp(context: LoopContext, task: string, message: string): Promise<Step> {
  const split = commandTask(message, '$split');
  if (split !== undefined) {
    const result = await runSkill(context, 'next', `$split ${split}`);
    return result.ok ? 'worked' : skillFailed(context, `$split ${split}`, result);
  }
  const accept = commandTask(message, '$accept');
  if (accept !== undefined) {
    const result = await runSkill(context, 'next', `$accept ${accept}`);
    return result.ok ? 'worked' : skillFailed(context, `$accept ${accept}`, result);
  }
  const active = context.state.activeTask;
  if (active?.task === task) {
    // Следующий пункт мог уже закрыться предыдущим патчем: сначала это подтверждает узкий review,
    // чтобы не требовать фиктивный коммит и не звать plan разбирать отсутствующий дефект.
    let finding: ReviewFinding = active.findings[0] ?? { kind: 'КОД', text: active.workPrompt };
    if (active.findings[0] !== undefined) {
      const verdict = await runReview(
        context,
        task,
        `Узкая проверка без нового коммита: исполнитель сообщил «${message.trim()}». Проверь только ` +
          `пункт «${finding.text}» по текущему HEAD. Если он уже закрыт предыдущим патчем — OK; ` +
          'иначе верни тот же конкретный блокер.',
      );
      if (typeof verdict === 'string') return verdict;
      if (verdict.ok) {
        active.findings = batchReviewFindings(active.findings.slice(1));
        active.findingRetries = 0;
        active.phase = active.findings.length === 0 ? 'review' : 'work';
        await save(context);
        await context.say(
          `узкий review ${task}: пункт уже исправлен предыдущим патчем, осталось ${active.findings.length} пунктов`,
        );
        return 'worked';
      }
      active.findings = batchReviewFindings([...verdict.findings, ...active.findings.slice(1)]);
      finding = active.findings[0] ?? finding;
      await save(context);
    }
    // Если review подтвердил дефект, plan один раз предлагает другой подход/разбиение; повтор
    // той же роли без нового решения не запускается вслепую.
    return diagnoseFinding(
      context,
      task,
      finding,
      false,
      `Исполнитель не создал коммит по пункту «${finding.text}» задачи ${task} и не дал ` +
        `машинный маркер (СПЕК:/$split/$accept). Его отчёт: «${message.trim()}». Оцени: нужна ` +
        'переделка подхода, пункт стоит разбить, это инфраструктурный блокер без участия ' +
        'владельца, или правда нужно решение владельца.',
    );
  }
  return park(
    context,
    `task:${task}`,
    `${task} не создала локальный коммит — нужен ответ владельца через $decide или $done`,
    message,
  );
}

async function runProductWork(
  context: LoopContext,
  task: string,
  prompt: string,
  finding: ReviewFinding | undefined,
): Promise<Step | undefined> {
  const base = await head(context.git);
  const published = await remoteHead(context.git);
  const stage = await readStage(context.config.root);
  const source = taskBlock(stage.stageText, task);
  const ownerPrompt = context.state.activeTask?.workPrompt;
  const checkedPrompt =
    `${prompt}` +
    (finding !== undefined && ownerPrompt?.includes('\n')
      ? `\nИсходное поручение владельца:\n${ownerPrompt}`
      : '') +
    `\nДействующий текст задачи — источник ожидаемого поведения:\n${source}` +
    (finding === undefined
      ? '\nПеред первым review сверь каждый критерий с продуктовым путём и проверкой. Через rg найди все импорты, вызовы и старые тесты каждого удалённого или изменённого публичного имени. В UI-тесте сначала докажи существование и выбор целевого объекта и открытие нужного экрана; координаты бери из данных объекта и преобразования карты, не угадывай пиксели. CSS проверяй на управляемом экране, реальный ввод — отдельно. Не коммить частичное выполнение.'
      : '\nСверь замечания с этим текстом и текущим diff: не исправляй уже закрытый пункт повторно.');
  const continuation =
    context.state.resume === task
      ? `\nПродолжи незакоммиченную работу этой задачи. Предыдущая проверка: ${context.state.resumeNote ?? 'результат не записан'}. ${context.state.resumeNote?.includes('зелёные; создай коммит') ? 'Проверки уже зелёные: создай локальный коммит без дополнительных правок.' : 'Исправь причину красной проверки в продукте или фикстуре, проверь и создай коммит.'}`
      : '';
  const beforePaths = await changedPaths(context.git);
  let newForbidden: string[] = [];
  const result = await session(context, 'next', checkedPrompt + continuation).finally(async () => {
    const afterPaths = await changedPaths(context.git);
    const added = afterPaths.filter((path) => !beforePaths.includes(path));
    newForbidden = isInfraTask(task) ? [] : forbiddenWorkingPaths(added);
    if (newForbidden.length > 0 || afterPaths.length === 0) return;
    const active = context.state.activeTask;
    if (active?.task !== task) return;
    active.workDirtyPaths = [...new Set([...(active.workDirtyPaths ?? []), ...afterPaths])];
    context.state.resume = task;
    await save(context);
  });
  if (newForbidden.length > 0)
    return park(context, `scope:${task}`, scopeViolation(task, newForbidden), result.message);
  if (result.failure !== undefined)
    return backoff(context, `${firstLine(prompt)}: ${result.failure}`, result.message);
  if ((await remoteHead(context.git)) !== published)
    return park(context, `push:${task}`, `${task}: рабочая сессия изменила origin до review`);
  if ((await dirtyFiles(context.git)) !== '') {
    const active = context.state.activeTask;
    const paths = await changedPaths(context.git);
    if (active !== undefined) {
      active.workDirtyPaths = paths;
      active.workDirtyAttempts = (active.workDirtyAttempts ?? 0) + 1;
    }
    context.state.resume = task;
    context.state.resumeNote = firstLine(result.message);
    delete context.state.waitingAnswer;
    delete context.state.parked;
    await save(context);
    const touched = [
      ...new Set([...paths, ...(await changedPathsBetween(context, active?.base ?? base))]),
    ];
    let evidence = await verifyTouchedTests(context, touched);
    if (evidence !== undefined && (await formatOwnedWork(context, paths, evidence))) {
      evidence = await verifyTouchedTests(context, touched);
    }
    if (evidence === undefined) {
      if (active !== undefined) delete active.lastDirtyFailure;
      const committed = await commitVerifiedWork(context, task, paths);
      if (committed.kind === 'committed') {
        delete context.state.resume;
        delete context.state.resumeNote;
        if (active !== undefined) {
          delete active.workDirtyPaths;
          delete active.workDirtyAttempts;
          delete active.verifiedDirtyPaths;
        }
        await save(context);
        return undefined;
      }
      if (committed.kind === 'skipped') {
        if (active !== undefined) active.verifiedDirtyPaths = [...paths].sort();
        context.state.resumeNote = 'Целевые тесты и verify зелёные; создай коммит';
        await save(context);
        return 'worked';
      }
      evidence = committed.reason ?? 'git commit: неизвестная ошибка';
    }
    if (active !== undefined) delete active.verifiedDirtyPaths;
    const signature = checkFailureSignature(evidence);
    const repeated = active?.lastDirtyFailure === signature;
    if (active !== undefined) active.lastDirtyFailure = signature;
    if ((active?.workDirtyAttempts ?? 0) < 2) {
      context.state.resumeNote = evidence.slice(-2_000);
      await save(context);
      return 'worked';
    }
    const verdict = await runReview(
      context,
      task,
      `Узкая диагностика незакоммиченной работы после ${active?.workDirtyAttempts ?? 2} попыток. Предыдущий диагноз: ${active?.findings[0]?.text ?? 'нет'}. Отчёт исполнителя: ${result.message}. Фактическая проверка:\n${evidence}\nПроверь только текущие файлы ${paths.join(', ')}. Если ошибка повторилась после прежнего диагноза, объясни, почему он не помог, и назови другой проверяемый путь. Если тест не дошёл до проверяемого поведения, назови нарушенную предпосылку. Верни одну причину как КОД:/ТЕСТ:, не запрашивай решение владельца для ошибки теста.`,
    );
    if (typeof verdict === 'string') return verdict;
    if (active !== undefined) {
      const findings = verdict.ok
        ? [{ kind: 'КОД' as const, text: `КОД: проверка красная — ${evidence}` }]
        : batchReviewFindings(verdict.findings);
      active.findings =
        (active.workDirtyAttempts ?? 0) >= 3 && repeated
          ? [
              {
                kind: 'ПЕРЕДЕЛАТЬ',
                text:
                  'ПЕРЕДЕЛАТЬ: повторная незакоммиченная попытка не устранила красную ' +
                  'предпосылку. Сначала установи, почему тест не достигает нужного состояния; ' +
                  'замени способ подготовки состояния или механизм по диагнозу reviewer, ' +
                  'не меняя посторонний код. Диагноз: ' +
                  findings.map((item) => item.text).join(' | '),
              },
            ]
          : findings;
    }
    await save(context);
    return 'worked';
  }
  if ((await head(context.git)) === base) return followUp(context, task, result.message);
  delete context.state.resume;
  delete context.state.resumeNote;
  delete context.state.waitingAnswer;
  if (context.state.activeTask?.task === task) {
    delete context.state.activeTask.specBounceStreak;
    delete context.state.activeTask.workDirtyPaths;
    delete context.state.activeTask.workDirtyAttempts;
    delete context.state.activeTask.verifiedDirtyPaths;
    delete context.state.activeTask.lastDirtyFailure;
  }
  await save(context);
  if (!isInfraTask(task)) {
    // Правка кода цикла не самовольна, если именно её назвал сам пункт review (findingPrompt
    // передаёт исполнителю ровно этот один пункт) — 07/T22 ловил самовольную правку, а не
    // исполнение дефекта, который независимый review уже нашёл и назвал по имени файла.
    const forbidden = (await forbiddenPaths(context.git, base)).filter(
      (path) => finding === undefined || !mentionsStreakFile(finding.text, path),
    );
    if (forbidden.length > 0)
      return park(context, `scope:${task}`, scopeViolation(task, forbidden), result.message);
  }
  return undefined;
}

async function recoverCommittedWork(
  context: LoopContext,
  task: string,
  finding: ReviewFinding | undefined,
  base: string,
  published: string,
): Promise<Step | undefined> {
  if ((await remoteHead(context.git)) !== published)
    return park(context, `push:${task}`, `${task}: origin изменился во время оборванной сессии`);
  if ((await dirtyFiles(context.git)) !== '')
    return park(context, `resume:${task}`, `${task}: оборванная сессия оставила грязное дерево`);
  if (!isInfraTask(task)) {
    const forbidden = (await forbiddenPaths(context.git, base)).filter(
      (path) => finding === undefined || !mentionsStreakFile(finding.text, path),
    );
    if (forbidden.length > 0)
      return park(context, `scope:${task}`, scopeViolation(task, forbidden));
  }
  return undefined;
}

async function changedPathsBetween(context: LoopContext, base: string): Promise<string[]> {
  return (await context.git.run(['diff', '--name-only', `${base}..HEAD`]))
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
}

async function headFile(context: LoopContext, path: string): Promise<string> {
  const result = await context.git.attempt(['show', `HEAD:${path}`]);
  return result.code === 0 ? result.stdout : '';
}

async function commitCompletion(context: LoopContext, task: string): Promise<Step | undefined> {
  const stage = await readStage(context.config.root);
  const marked = setTaskMark(stage.stageText, task, 'x');
  const remaining = parseQueue(stage.status).find(
    (candidate) => candidate !== task && [' ', '~'].includes(taskMark(marked, candidate) ?? ''),
  );
  const status = stage.status.replace(
    /^\| Текущая задача \|.*$/mu,
    `| Текущая задача | ${remaining ?? 'нет'} |`,
  );
  const allowed = new Set([stage.path, 'docs/STATUS.md']);
  const staged = (await context.git.run(['diff', '--cached', '--name-only']))
    .split(/\r?\n/u)
    .filter(Boolean);
  const foreign = staged.filter((path) => !allowed.has(path));
  if (foreign.length > 0)
    return park(
      context,
      `finalize:${task}`,
      `${task}: перед служебным коммитом уже staged чужие файлы: ${foreign.join(', ')}`,
    );
  const stageAtHead = await headFile(context, stage.path);
  const statusAtHead = await headFile(context, 'docs/STATUS.md');
  await writeFile(join(context.config.root, stage.path), marked, 'utf8');
  await writeFile(join(context.config.root, 'docs/STATUS.md'), status, 'utf8');
  if (marked !== stageAtHead || status !== statusAtHead) {
    await context.git.run(['add', '--', stage.path, 'docs/STATUS.md']);
    await context.git.run(['commit', '-m', `docs(docs): завершена ${task}`, '-m', `Этап: ${task}`]);
  }
  const active = context.state.activeTask;
  if (active !== undefined) active.phase = 'docs-ci';
  await save(context);
  return undefined;
}

async function finishTask(context: LoopContext, task: string): Promise<Step | undefined> {
  const active = context.state.activeTask;
  if (active === undefined) throw new Error('нет активной задачи');
  const expected = active.codeHead ?? (await context.git.run(['rev-parse', 'HEAD^']));
  const publishStop = await publishReviewed(context, task, expected);
  if (publishStop !== undefined) return publishStop;
  const publishedHead = await head(context.git);
  const docsCi = await waitCi(
    context,
    `фиксации ${task}`,
    true,
    active.ciTimeoutRerun?.head === publishedHead ? active.ciTimeoutRerun.afterAttempt : undefined,
  );
  if (docsCi.verdict === 'red' && (await retryTimedOutCi(context, task, docsCi, publishedHead)))
    return 'worked';
  if (docsCi.verdict !== 'green')
    return backoff(
      context,
      `CI docs-коммита ${task} не зелёный: ${docsCi.line}`,
      docsCi.details ?? '',
    );
  delete active.ciTimeoutRerun;
  if ((await head(context.git)) !== publishedHead)
    return backoff(context, `${task}: HEAD изменился во время проверки CI`, '');
  if (active.workspaceRoot !== undefined) {
    const branch = await publishBranch(context.git);
    context.state.pendingPromotion = {
      task,
      workspaceRoot: active.workspaceRoot,
      branch,
      head: publishedHead,
    };
  }
  delete context.state.activeTask;
  delete context.state.resume;
  await forgetSpec(context, task);
  await save(context);
  context.config.board?.count('done');
  await context.say(`готово: ${task}`);
  return undefined;
}

/** Таймаут в CI проверяем повтором того же SHA; код задачи не меняется из-за сбоя раннера. */
async function retryTimedOutCi(
  context: LoopContext,
  task: string,
  ci: CiResult,
  currentHead: string,
): Promise<boolean> {
  const active = context.state.activeTask;
  const runId = /\/actions\/runs\/(\d+)/u.exec(ci.line)?.[1];
  if (
    active === undefined ||
    !/Test timed out in \d+ms/iu.test(ci.details ?? '') ||
    ci.attempt === undefined ||
    runId === undefined ||
    context.config.github === undefined ||
    active.ciTimeoutRerun?.head === currentHead
  )
    return false;
  try {
    await context.config.github.rerunFailedJobs(Number(runId));
  } catch (error) {
    await context.say(
      `${task}: не удалось перезапустить упавший job: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  active.ciTimeoutRerun = { head: currentHead, afterAttempt: ci.attempt };
  active.ciRetries = 0;
  await save(context);
  await context.say(`${task}: таймаут теста в CI, перезапущен упавший job того же SHA`);
  return true;
}

/** После старого красного CI допускается перепроверка HEAD с одними служебными коммитами. */
async function ciRecheckSafe(
  context: LoopContext,
  remoteBase: string | undefined,
): Promise<boolean> {
  if (remoteBase === undefined) return false;
  const current = await head(context.git);
  if (current === remoteBase) return true;
  if (!(await isAncestor(context.git, remoteBase, current))) return false;
  const trailers = await context.git.run([
    'log',
    '--format=%(trailers:key=Этап,valueonly)',
    `${remoteBase}..HEAD`,
  ]);
  const commits = trailers
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return commits.length > 0 && commits.every((line) => /^\d{2}\/infra$/u.test(line));
}

async function rememberPublished(
  context: LoopContext,
  task: string,
  published: string,
): Promise<void> {
  const active = context.state.activeTask;
  let changed = false;
  if (active?.task === task && active.remoteBase !== published) {
    active.remoteBase = published;
    changed = true;
  }
  if (context.state.parked?.key === `sync:${task}`) {
    delete context.state.parked;
    changed = true;
  }
  if (changed) await save(context);
}

async function publishReviewed(
  context: LoopContext,
  task: string,
  expectedRemote: string,
): Promise<Step | undefined> {
  const branch = await publishBranch(context.git);
  const fetched = await context.git.attempt(['fetch', 'origin', branch]);
  if (fetched.code !== 0)
    return backoff(context, `${task}: не удалось обновить origin/${branch}`, fetched.stderr.trim());
  const local = await head(context.git);
  const remote = await remoteHead(context.git);
  if (remote === local) {
    await rememberPublished(context, task, local);
    return undefined;
  }
  // origin ушёл вперёд, но это коммиты, которые уже есть в нашем HEAD (например, инфра-фикс
  // опубликовали отдельно, пока эта задача ждала review) — не чужая, расходящаяся история, с
  // которой нужен rebase, а просто устаревшая отметка «последний известный origin» этой задачи.
  if (remote !== expectedRemote && !(await isAncestor(context.git, remote, local)))
    return park(
      context,
      `sync:${task}`,
      `${task}: origin/${branch} изменился после review (${remote || 'нет ref'} вместо ${expectedRemote}); автоматический rebase запрещён`,
    );
  const pushed = await context.git.attempt(['push', 'origin', `HEAD:${branch}`]);
  if (pushed.code !== 0)
    return backoff(context, `${task}: push проверенного HEAD не прошёл`, pushed.stderr.trim());
  await rememberPublished(context, task, local);
  return undefined;
}

async function consolidateTaskHistory(
  context: LoopContext,
  task: string,
  base: string,
): Promise<Step | undefined> {
  const count = Number(await context.git.run(['rev-list', '--count', `${base}..HEAD`]));
  if (!Number.isSafeInteger(count) || count <= 1) return undefined;
  const messages = await context.git.run(['log', '--format=%B%x00', `${base}..HEAD`]);
  if (/^Этап:\s*\d{2}\/infra\s*$/mu.test(messages)) {
    await context.say(`${task}: служебные коммиты сохранены отдельно; историю задачи не свожу`);
    return undefined;
  }
  const source = await head(context.git);
  const reset = await context.git.attempt(['reset', '--soft', base]);
  if (reset.code !== 0)
    return park(
      context,
      `squash:${task}`,
      `${task}: не удалось подготовить сводный коммит`,
      reset.stderr,
    );
  const committed = await context.git.attempt(['commit', '-C', source]);
  if (committed.code !== 0)
    return park(
      context,
      `squash:${task}`,
      `${task}: не удалось создать сводный коммит после soft reset`,
      committed.stderr,
    );
  await context.say(`${task}: ${count} локальных коммитов сведены в один перед push`);
  return undefined;
}

async function runPhase(context: LoopContext): Promise<TaskRun> {
  const active = context.state.activeTask;
  if (active === undefined) throw new Error('нет активной задачи');
  const { task } = active;
  if (active.phase === 'work') {
    const finding = active.findings[0];
    const currentHead = await head(context.git);
    if (
      finding?.kind === 'КОД' &&
      finding.text.startsWith('КОД: CI точного SHA красный') &&
      (await ciRecheckSafe(context, active.remoteBase)) &&
      active.ciDiagnosticRecheck !== currentHead &&
      active.workAttempt === undefined
    ) {
      active.ciDiagnosticRecheck = currentHead;
      active.findings = [];
      active.phase = 'ci';
      await save(context);
      return { step: 'worked', done: false };
    }
    if (finding?.kind === 'ПЛАН') {
      const step = await diagnoseFinding(context, task, finding);
      return { step, done: false };
    }
    if (active.workAttempt !== undefined && (await head(context.git)) !== active.workAttempt.head) {
      const stop = await recoverCommittedWork(
        context,
        task,
        finding,
        active.workAttempt.head,
        active.workAttempt.remote,
      );
      if (stop !== undefined) return { step: stop, done: false };
    } else {
      active.workAttempt = {
        head: await head(context.git),
        remote: await remoteHead(context.git),
        dirtyPaths: await changedPaths(context.git),
      };
      await save(context);
      const stop = await runProductWork(
        context,
        task,
        finding === undefined ? active.workPrompt : findingPrompt(task, finding),
        finding,
      );
      if (stop !== undefined) {
        delete active.workAttempt;
        await save(context);
        return { step: stop, done: false };
      }
    }
    const roundBase = active.workAttempt?.head;
    delete active.workAttempt;
    if (roundBase !== undefined)
      updateFixStreak(active, await changedPathsBetween(context, roundBase));
    const failure = await verifyTouchedTests(
      context,
      await changedPathsBetween(context, active.base),
    );
    if (failure !== undefined) {
      const currentHead = await head(context.git);
      const signature = checkFailureSignature(failure);
      const repeated =
        active.lastTestFailure?.signature === signature &&
        active.lastTestFailure.head !== currentHead;
      active.lastTestFailure = { signature, head: currentHead };
      active.findings = [
        repeated
          ? {
              kind: 'ПЛАН',
              text:
                `ПЛАН: после нового коммита повторилось то же падение проверки. ` +
                `Определи конкретную неверную предпосылку теста или продукта и другой способ ` +
                `её исправить; очередной такой же патч не продвинул задачу. ${failure}`,
            }
          : { kind: 'КОД', text: `КОД: проверки задачи красные — ${failure}` },
      ];
      active.phase = 'work';
      await save(context);
      return { step: 'worked', done: false };
    }
    delete active.lastTestFailure;
    active.phase = finding === undefined ? 'review' : 'target-review';
    await save(context);
  }
  if (active.phase === 'review' || active.phase === 'target-review') {
    const targeted = active.phase === 'target-review';
    const checkedHead = await head(context.git);
    if (!targeted) {
      await context.say(`… полный локальный контур перед review ${task}`);
      const runCheck = (): ReturnType<typeof context.config.runCommand> =>
        context.config.runCommand('pnpm', ['check'], {
          cwd: context.config.root,
          timeoutMs: 20 * 60_000,
        });
      let checked = await runCheck();
      if (
        checked.code !== 0 &&
        (await testTimedOut(context.config.root, checked.stdout, checked.stderr)) &&
        (await head(context.git)) === checkedHead
      ) {
        await context.say(`полный check ${task}: таймаут теста, повторяю на том же HEAD`);
        checked = await runCheck();
      }
      if ((await head(context.git)) !== checkedHead)
        return {
          step: await park(
            context,
            `check-head:${task}`,
            `${task}: HEAD изменился во время полного check`,
          ),
          done: false,
        };
      if (checked.code !== 0) {
        const failure = prePushFailure(checked.stdout, checked.stderr);
        const diagnosis = await runReview(
          context,
          task,
          'Полный локальный контур перед review красный. Классифицируй все ошибки по матрице ' +
            'задачи: устаревшее или противоречащее задаче ожидание — ТЕСТ, расхождение продукта ' +
            `с задачей — КОД. Не требуй от продукта удовлетворять неверному тесту.\n${failure}`,
        );
        if (typeof diagnosis === 'string') return { step: diagnosis, done: false };
        active.findings = diagnosis.ok
          ? [
              {
                kind: 'КОД',
                text:
                  'КОД: полный check красный. Воспроизведи упавший тест и проверь его ' +
                  'предпосылки до изменения продукта: если нужный объект или экран не подготовлен, ' +
                  `исправь фикстуру; если проверка дошла до действия — исправь продукт. ${failure}`,
              },
            ]
          : batchReviewFindings(diagnosis.findings);
        active.findingRetries = 0;
        active.phase = 'work';
        await save(context);
        await context.say(`полный локальный контур перед review ${task}: FAIL`);
        return { step: 'worked', done: false };
      }
      await context.say(`полный локальный контур перед review ${task}: OK`);
    }
    const finding = active.findings[0];
    const note = targeted
      ? `Узкая проверка: проверь только исправление пункта «${finding?.text ?? ''}». Новые замечания не добавляй; они проверятся финальным review.`
      : 'Финальный полный review локального diff задачи. Верни все найденные блокеры одним списком.';
    const verdict = await runReview(context, task, note, checkedHead);
    if (typeof verdict === 'string') return { step: verdict, done: false };
    if (!verdict.ok) {
      context.config.board?.count('returns');
      if (targeted) {
        active.findingRetries = (active.findingRetries ?? 0) + 1;
        if (active.findingRetries >= 2) {
          const streak = active.fixStreak;
          const rejected = active.findings[0];
          active.findings = [
            {
              kind: 'ПЛАН',
              text:
                `ПЛАН: узкий review дважды не принял один и тот же пункт по задаче ${task}` +
                (streak !== undefined
                  ? ` (файл ${streak.file} патчится ${streak.count} раз(а) подряд в этой задаче)`
                  : '') +
                ` — реши, нужен ли цельный редизайн механизма вместо продолжения точечных попыток. Отклонённый пункт: ${rejected?.text ?? ''}`,
            },
          ];
          active.findingRetries = 0;
          active.phase = 'work';
          await save(context);
          await context.say(
            `узкий review ${task}: пункт дважды не принят — зову plan оценить переделку перед остановкой`,
          );
          return { step: 'worked', done: false };
        }
        active.findings = batchReviewFindings([...verdict.findings, ...active.findings.slice(1)]);
        await save(context);
        await context.say(
          `узкий review ${task}: пункт не принят, запускаю диагностику plan перед повтором`,
        );
        const step = await diagnoseFinding(
          context,
          task,
          active.findings[0] as ReviewFinding,
          true,
        );
        return { step, done: false };
      }
      const nextFindings = batchReviewFindings(verdict.findings);
      if (!targeted) active.fullReviewRounds = (active.fullReviewRounds ?? 0) + 1;
      const streak = active.fixStreak;
      const first = nextFindings[0];
      if (
        !targeted &&
        streak !== undefined &&
        streak.count >= REDESIGN_STREAK &&
        first !== undefined &&
        mentionsStreakFile(first.text, streak.file)
      ) {
        active.findings = [
          {
            kind: 'ПЛАН',
            text:
              `ПЛАН: файл ${streak.file} точечно патчился ${streak.count} раз(а) подряд в задаче ` +
              `${task}, и финальный review всё равно находит там новый дефект — реши, нужен ли ` +
              `цельный редизайн механизма вместо очередного точечного патча. Свежий пункт review: ${first.text}`,
          },
          ...nextFindings.slice(1),
        ];
        active.findingRetries = 0;
        active.phase = 'work';
        await save(context);
        await context.say(
          `финальный review ${task}: файл ${streak.file} патчится уже ${streak.count}-й раз подряд — зову plan оценить переделку`,
        );
        return { step: 'worked', done: false };
      }
      if (
        !targeted &&
        first !== undefined &&
        (active.fullReviewRounds ?? 0) >= REVIEW_ROUND_LIMIT
      ) {
        const rounds = active.fullReviewRounds;
        // Диагностируется сам свежий пункт (сохраняет его kind — КОД/ТЕСТ), а не обёртка ПЛАН:
        // «переделать» обязана уйти той же роли (кодеру или автору тестов), а не всегда кодеру.
        active.findings = nextFindings;
        active.findingRetries = 0;
        active.fullReviewRounds = 0;
        await save(context);
        await context.say(
          `финальный review ${task}: review не сходится ${REVIEW_ROUND_LIMIT}-й круг подряд — зову plan`,
        );
        const step = await diagnoseFinding(
          context,
          task,
          active.findings[0] as ReviewFinding,
          true,
          `Финальный review задачи ${task} ${rounds} раз(а) подряд возвращает новые пункты ` +
            `(разные файлы/формулировки) вместо схождения к нулю. Свежий пункт: «${first.text}». ` +
            'Оцени: это реальный тупик, который нужно переделать целиком, или review предъявляет ' +
            'избыточные требования к уже достаточному решению?',
        );
        return { step, done: false };
      }
      active.findings = nextFindings;
      active.findingRetries = 0;
      active.phase = 'work';
      await save(context);
      await context.say(
        `финальный review ${task}: ${verdict.findings.length} пунктов собраны в ${active.findings.length} пакет(а) по ролям`,
      );
      return { step: 'worked', done: false };
    }
    if (targeted) {
      active.findings = active.findings.slice(1);
      active.findingRetries = 0;
      delete active.resumeWorkAfterFindings;
      active.phase = active.findings.length === 0 ? 'review' : 'work';
      await save(context);
      await context.say(`узкий review ${task}: OK, осталось ${active.findings.length} пунктов`);
      return { step: 'worked', done: false };
    }
    delete active.fixStreak;
    delete active.fullReviewRounds;
    delete active.specBounceStreak;
    active.phase = 'consolidate';
    await save(context);
  }
  if (active.phase === 'consolidate') {
    const squashStop = await consolidateTaskHistory(context, task, active.base);
    if (squashStop !== undefined) return { step: squashStop, done: false };
    active.phase = 'pre-push';
    await save(context);
  }
  if (active.phase === 'pre-push') {
    await context.say(`… локальная приёмка ${task}`);
    const runPrePush = (): ReturnType<typeof context.config.runCommand> =>
      context.config.runCommand('pnpm', ['verify:prepush'], {
        cwd: context.config.root,
        timeoutMs: 20 * 60_000,
      });
    let result = await runPrePush();
    if (
      result.code !== 0 &&
      (await testTimedOut(context.config.root, result.stdout, result.stderr))
    ) {
      await context.say(
        `локальная приёмка ${task}: таймаут теста, повторяю тот же gate на том же HEAD`,
      );
      result = await runPrePush();
    }
    if (result.code !== 0) {
      active.findings = [
        {
          kind: 'КОД',
          text: `КОД: локальная приёмка перед push красная — ${prePushFailure(result.stdout, result.stderr)}`,
        },
      ];
      active.findingRetries = 0;
      active.phase = 'work';
      await save(context);
      await context.say(`локальная приёмка ${task}: FAIL, push запрещён`);
      return { step: 'worked', done: false };
    }
    active.phase = 'visual';
    await save(context);
    await context.say(`локальная приёмка ${task}: OK`);
  }
  if (active.phase === 'visual') {
    const stop = await runVisualGate(context, task, active.base);
    if (stop !== undefined) return { step: stop, done: false };
    active.phase = 'ci';
    await save(context);
  }
  if (active.phase === 'ci') {
    const stage = await readStage(context.config.root);
    if (taskMark(stage.stageText, task) === 'x') {
      active.phase = 'docs-ci';
      await save(context);
      return { step: 'worked', done: false };
    }
    const publishStop = await publishReviewed(context, task, active.remoteBase ?? active.base);
    if (publishStop !== undefined) return { step: publishStop, done: false };
    const currentHead = await head(context.git);
    const ci = await waitCi(
      context,
      task,
      true,
      active.ciTimeoutRerun?.head === currentHead ? active.ciTimeoutRerun.afterAttempt : undefined,
    );
    if (ci.verdict === 'unknown')
      return {
        step: await backoff(context, `CI ${task} не проверен: ${ci.line}`, ''),
        done: false,
      };
    if (ci.verdict === 'red') {
      active.ciDiagnosticRecheck = currentHead;
      if (await retryTimedOutCi(context, task, ci, currentHead))
        return { step: 'worked', done: false };
      active.ciRetries = (active.ciRetries ?? 0) + 1;
      const failure = `${ci.line}${ci.details === undefined ? '' : `\n${ci.details}`}`;
      active.findings = [
        active.ciRetries >= 2
          ? {
              kind: 'ПЛАН',
              text:
                `ПЛАН: CI красный второй раз подряд по задаче ${task} — очередной точечный патч ` +
                `уже не помог один раз; реши, нужен ли цельный пересмотр решения. Последний провал: ${failure}`,
            }
          : { kind: 'КОД', text: `КОД: CI точного SHA красный — ${failure}` },
      ];
      active.phase = 'work';
      await save(context);
      return { step: 'worked', done: false };
    }
    delete active.ciRetries;
    delete active.ciTimeoutRerun;
    delete active.ciDiagnosticRecheck;
    active.codeHead = await head(context.git);
    active.phase = 'finalize';
    await save(context);
    return { step: 'worked', done: false };
  }
  if (active.phase === 'finalize') {
    const stop = await commitCompletion(context, task);
    if (stop !== undefined) return { step: stop, done: false };
    return { step: 'worked', done: false };
  }
  if (active.phase === 'docs-ci') {
    const stop = await finishTask(context, task);
    return stop === undefined ? { step: 'worked', done: true } : { step: stop, done: false };
  }
  return { step: 'worked', done: false };
}

/** Запускает или продолжает единственную задачу ветки этапа. */
export async function processTask(
  context: LoopContext,
  task: string,
  options: { readonly mark: string; readonly workPrompt: string; readonly resume?: boolean },
): Promise<TaskRun> {
  if (context.state.activeTask === undefined) {
    context.state.activeTask = {
      task,
      base: await head(context.git),
      ...(context.config.stateRoot === undefined ? {} : { workspaceRoot: context.config.root }),
      remoteBase: await remoteHead(context.git),
      workPrompt: options.workPrompt,
      phase: 'work',
      findings: [],
    };
    await save(context);
  }
  if (context.state.activeTask.task !== task)
    return {
      step: await park(
        context,
        `active:${context.state.activeTask.task}`,
        `сначала нужно закончить ${context.state.activeTask.task}, затем ${task}`,
      ),
      done: false,
    };
  const active = context.state.activeTask;
  if (active.findings.some((finding) => finding.kind === 'ТЕСТ')) {
    active.findings = batchReviewFindings(active.findings);
    await forgetSpec(context, task);
    await save(context);
  }
  if (options.resume === true && options.workPrompt !== '') {
    context.state.activeTask = { ...context.state.activeTask, workPrompt: options.workPrompt };
  }
  return runPhase(context);
}

/** После исчерпания кругов plan может уточнить задачу; оставлено для совместимости Issues. */
export async function replanTask(context: LoopContext, task: string): Promise<Step> {
  const planned = await runPlan(context, task);
  return typeof planned === 'string' ? planned : 'worked';
}
