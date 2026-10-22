// Последовательный автомат задачи: spec → локальная работа → review → пункты по одному → push → CI.
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  backoff,
  checkPermissions,
  firstLine,
  lastLines,
  park,
  readStage,
  runSkill,
  save,
  session,
  waitCi,
  type LoopContext,
  type SkillResult,
  type Step,
} from './context.ts';
import { diagnoseFinding, findingPrompt, runTestFix } from './finding-repair.ts';
import { currentBranch, dirtyFiles, head, remoteHead } from './git.ts';
import { runPlan } from './plan.ts';
import { runReview, type ReviewFinding } from './review.ts';
import { forbiddenPaths, isInfraTask, scopeViolation } from './scope-guard.ts';
import { forgetSpec, prepareSpec, specFiles, specViolation, withSpec } from './spec.ts';
import { commandTask, parseQueue, setTaskMark, taskMark } from './stage-file.ts';
import type { ActiveTask } from './state.ts';

export interface TaskRun {
  readonly step: Step;
  readonly done: boolean;
}

/** Подряд точечных патчей одного продуктового файла, после которых зовётся plan (не ещё патч). */
export const REDESIGN_STREAK = 3;

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
  const specRemark = message
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith('СПЕК:'));
  if (specRemark !== undefined && context.state.activeTask?.task === task) {
    if (context.state.activeTask.findings.length === 0)
      context.state.activeTask.resumeWorkAfterFindings = true;
    context.state.activeTask.findings = [
      {
        kind: 'ТЕСТ',
        text: `ТЕСТ: неверный приёмочный тест — ${specRemark.slice('СПЕК:'.length).trim()}`,
      },
      ...context.state.activeTask.findings,
    ];
    await save(context);
    return 'worked';
  }
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
): Promise<Step | undefined> {
  const base = await head(context.git);
  const published = await remoteHead(context.git);
  const locked = specFiles(context, task);
  const result = await session(context, 'next', withSpec(prompt, task, locked), locked);
  if (result.failure !== undefined)
    return backoff(context, `${firstLine(prompt)}: ${result.failure}`, result.message);
  if ((await remoteHead(context.git)) !== published)
    return park(context, `push:${task}`, `${task}: рабочая сессия изменила origin до review`);
  if ((await head(context.git)) === base && /^СПЕК:/mu.test(result.message))
    return followUp(context, task, result.message);
  if ((await dirtyFiles(context.git)) !== '') {
    if (context.state.resume !== task) {
      context.state.resume = task;
      await save(context);
      return 'worked';
    }
    context.state.resume = task;
    context.state.waitingAnswer = {
      task,
      reason: `${task} ждёт твоего ответа: «${firstLine(result.message)}». Ответ — Issue «$decide» с решением; работа задачи останется и продолжится сама`,
    };
    await save(context);
    return park(context, `resume:${task}`, context.state.waitingAnswer.reason, result.message);
  }
  if ((await head(context.git)) === base) return followUp(context, task, result.message);
  delete context.state.resume;
  delete context.state.resumeNote;
  delete context.state.waitingAnswer;
  await save(context);
  const violation = await specViolation(context, task);
  if (violation !== undefined) return park(context, `spec:${task}`, violation, result.message);
  if (!isInfraTask(task)) {
    const forbidden = await forbiddenPaths(context.git, base);
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
  if (finding?.kind === 'ТЕСТ') {
    if (!(await checkPermissions(context, base, context.definitions.specPaths)))
      return park(context, `spec:${task}`, `$spec ${task} изменил файлы вне тестов`);
    const saved = { ...(context.state.spec[task] ?? {}) };
    for (const path of await changedPathsBetween(context, base))
      saved[path] = await readFile(join(context.config.root, path), 'utf8');
    context.state.spec[task] = saved;
    await save(context);
    return undefined;
  }
  const violation = await specViolation(context, task);
  if (violation !== undefined) return park(context, `spec:${task}`, violation);
  if (!isInfraTask(task)) {
    const forbidden = await forbiddenPaths(context.git, base);
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
  const docsCi = await waitCi(context, `фиксации ${task}`, true);
  if (docsCi.verdict !== 'green')
    return backoff(context, `CI docs-коммита ${task} не зелёный: ${docsCi.line}`, '');
  delete context.state.activeTask;
  delete context.state.resume;
  await forgetSpec(context, task);
  await save(context);
  context.config.board?.count('done');
  await context.say(`готово: ${task}`);
  return undefined;
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
  const branch = await currentBranch(context.git);
  const fetched = await context.git.attempt(['fetch', 'origin', branch]);
  if (fetched.code !== 0)
    return backoff(context, `${task}: не удалось обновить origin/${branch}`, fetched.stderr.trim());
  const local = await head(context.git);
  const remote = await remoteHead(context.git);
  if (remote === local) {
    await rememberPublished(context, task, local);
    return undefined;
  }
  if (remote !== expectedRemote)
    return park(
      context,
      `sync:${task}`,
      `${task}: origin/${branch} изменился после review (${remote || 'нет ref'} вместо ${expectedRemote}); автоматический rebase запрещён`,
    );
  const pushed = await context.git.attempt(['push', 'origin', branch]);
  if (pushed.code !== 0)
    return backoff(context, `${task}: push проверенного HEAD не прошёл`, pushed.stderr.trim());
  await rememberPublished(context, task, local);
  return undefined;
}

async function runPhase(context: LoopContext): Promise<TaskRun> {
  const active = context.state.activeTask;
  if (active === undefined) throw new Error('нет активной задачи');
  const { task } = active;
  if (active.phase === 'work') {
    const finding = active.findings[0];
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
      };
      await save(context);
      const stop =
        finding?.kind === 'ТЕСТ'
          ? await runTestFix(context, task, finding)
          : await runProductWork(
              context,
              task,
              finding === undefined ? active.workPrompt : findingPrompt(task, finding),
            );
      if (stop === 'rerouted') {
        delete active.workAttempt;
        active.findingRetries = 0;
        await save(context);
        return { step: 'worked', done: false };
      }
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
    active.phase = finding === undefined ? 'review' : 'target-review';
    await save(context);
  }
  if (active.phase === 'review' || active.phase === 'target-review') {
    const targeted = active.phase === 'target-review';
    const finding = active.findings[0];
    const note = targeted
      ? `Узкая проверка: проверь только исправление пункта «${finding?.text ?? ''}». Новые замечания не добавляй; они проверятся финальным review.`
      : 'Финальный полный review локального diff задачи. Верни все найденные блокеры одним списком.';
    const verdict = await runReview(context, task, note);
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
        active.findings = [...verdict.findings, ...active.findings.slice(1)];
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
      const nextFindings = targeted
        ? [...verdict.findings, ...active.findings.slice(1)]
        : [...verdict.findings];
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
      active.findings = nextFindings;
      active.findingRetries = 0;
      active.phase = 'work';
      await save(context);
      await context.say(
        `финальный review ${task}: ${active.findings.length} пунктов, исправляется первый`,
      );
      return { step: 'worked', done: false };
    }
    if (targeted) {
      active.findings = active.findings.slice(1);
      active.findingRetries = 0;
      if (active.findings.length === 0 && active.resumeWorkAfterFindings === true) {
        delete active.resumeWorkAfterFindings;
        active.phase = 'work';
      } else {
        active.phase = active.findings.length === 0 ? 'review' : 'work';
      }
      await save(context);
      await context.say(`узкий review ${task}: OK, осталось ${active.findings.length} пунктов`);
      return { step: 'worked', done: false };
    }
    delete active.fixStreak;
    active.phase = 'pre-push';
    await save(context);
  }
  if (active.phase === 'pre-push') {
    await context.say(`… локальная приёмка ${task}`);
    const result = await context.config.runCommand('pnpm', ['verify:prepush'], {
      cwd: context.config.root,
      timeoutMs: 20 * 60_000,
    });
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
    active.phase = 'ci';
    await save(context);
    await context.say(`локальная приёмка ${task}: OK`);
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
    const ci = await waitCi(context, task, true);
    if (ci.verdict === 'unknown')
      return {
        step: await backoff(context, `CI ${task} не проверен: ${ci.line}`, ''),
        done: false,
      };
    if (ci.verdict === 'red') {
      active.ciRetries = (active.ciRetries ?? 0) + 1;
      active.findings = [
        active.ciRetries >= 2
          ? {
              kind: 'ПЛАН',
              text:
                `ПЛАН: CI красный второй раз подряд по задаче ${task} — очередной точечный патч ` +
                `уже не помог один раз; реши, нужен ли цельный пересмотр решения. Последний провал: ${ci.line}`,
            }
          : { kind: 'КОД', text: `КОД: CI точного SHA красный — ${ci.line}` },
      ];
      active.phase = 'work';
      await save(context);
      return { step: 'worked', done: false };
    }
    delete active.ciRetries;
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
      remoteBase: await remoteHead(context.git),
      workPrompt: options.workPrompt,
      phase: 'work',
      findings: [],
    };
    const specStop = await prepareSpec(context, task, true);
    if (specStop !== undefined) return { step: specStop, done: false };
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
