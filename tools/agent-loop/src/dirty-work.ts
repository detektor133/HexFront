// Незакоммиченная работа задачи продолжается в том checkout, где её создали.
import { park, readStage, save, type LoopContext, type Step } from './context.ts';
import { changedPaths, head } from './git.ts';
import { processIssues } from './issues.ts';
import { forbiddenWorkingPaths, isInfraTask, scopeViolation } from './scope-guard.ts';
import { specFiles } from './spec.ts';
import { taskMark } from './stage-file.ts';
import { processTask, resumePrompt } from './tasks.ts';

/** Грязное дерево: доделка своей задачи, `$done` владельца или ожидание. */
async function dirtyTree(context: LoopContext, files: string): Promise<Step> {
  const { state, config } = context;
  if (state.activeTask !== undefined) {
    const paths = await changedPaths(context.git);
    const specs = new Set(specFiles(context, state.activeTask.task));
    // Приёмочные тесты `$spec` лежат незакоммиченными до продуктового коммита. Они штатны не
    // только в work: после repair-$spec задача отдельным тиком проходит узкий/full review.
    if (paths.length > 0 && paths.every((path) => specs.has(path)))
      return (
        await processTask(context, state.activeTask.task, {
          mark: taskMark((await readStage(config.root)).stageText, state.activeTask.task) ?? ' ',
          workPrompt: state.activeTask.workPrompt,
        })
      ).step;
  }
  if (state.activeTask?.phase === 'finalize')
    return (
      await processTask(context, state.activeTask.task, {
        mark: taskMark((await readStage(config.root)).stageText, state.activeTask.task) ?? ' ',
        workPrompt: state.activeTask.workPrompt,
      })
    ).step;
  if (state.resume !== undefined) {
    const mark = taskMark((await readStage(config.root)).stageText, state.resume) ?? ' ';
    const workPrompt = [resumePrompt(state.resume), state.resumeNote].filter(Boolean).join('\n');
    return (await processTask(context, state.resume, { mark, workPrompt, resume: true })).step;
  }
  const issue = await processIssues(context, true);
  if (issue !== undefined) return issue;
  // Вопрос исполнителя переживает перезапуск цикла: ждём ответа, а не доделки по кругу.
  const waiting = state.waitingAnswer;
  if (waiting !== undefined) return park(context, `resume:${waiting.task}`, waiting.reason);
  const list = files
    .split(/\r?\n/)
    .slice(0, 5)
    .map((line) => line.trim())
    .join(', ');
  return park(
    context,
    'dirty',
    `рабочее дерево не чистое (${list}). Работа владельца — Issue «$done NN/Tn»; недоделка задачи — pnpm agent:run --resume NN/Tn. Остальные Issues ждут чистого дерева`,
  );
}

/** Продолжает собственные незакоммиченные файлы задачи в выбранном checkout. */
export async function taskDirtyTree(context: LoopContext, files: string): Promise<Step> {
  const { state, git } = context;
  const active = state.activeTask;
  const owned = active?.workDirtyPaths;
  const paths = await changedPaths(git);
  if (active?.phase === 'work' && active.workAttempt?.dirtyPaths !== undefined) {
    const attempt = active.workAttempt;
    const initialPaths = attempt.dirtyPaths ?? [];
    if ((await head(git)) === attempt.head && initialPaths.every((path) => paths.includes(path))) {
      const added = paths.filter((path) => !initialPaths.includes(path));
      const forbidden = isInfraTask(active.task) ? [] : forbiddenWorkingPaths(added);
      if (forbidden.length > 0)
        return park(context, `scope:${active.task}`, scopeViolation(active.task, forbidden));
      active.workDirtyPaths = [...new Set([...(owned ?? []), ...paths])];
      state.resume = active.task;
      delete active.workAttempt;
      await save(context);
    }
  }
  if (active === undefined || state.resume !== active.task || active.workDirtyPaths === undefined)
    return dirtyTree(context, files);
  if (paths.some((path) => !active.workDirtyPaths?.includes(path)))
    return park(
      context,
      'dirty',
      `рабочее дерево не чистое: к ${active.task} добавлены чужие файлы`,
    );
  delete state.waitingAnswer;
  delete state.parked;
  await save(context);
  return (
    await processTask(context, active.task, {
      mark: taskMark((await readStage(context.config.root)).stageText, active.task) ?? ' ',
      workPrompt: `$task ${active.task}`,
    })
  ).step;
}
