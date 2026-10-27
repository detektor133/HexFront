// Агентный цикл: Issues владельца → «Очередь» этапа → закрытие этапа; без работы ждёт новых Issues.
import { MAIN_AGENT } from './board.ts';
import { loadAgentDefinitions } from './codex.ts';
import {
  endPause,
  settleWait,
  selfClearing,
  firstLine,
  openLog,
  park,
  readStage,
  readStatus,
  save,
  type AgentConfig,
  type LoopContext,
  type Step,
} from './context.ts';
import {
  changedPaths,
  currentBranch,
  dirtyFiles,
  head,
  makeGit,
  remoteHead,
  syncWithOrigin,
} from './git.ts';
import { parseIssueCommand, STOP_LABEL } from './github.ts';
import { processIssues } from './issues.ts';
import { planEnabled, selectPlannedTask } from './plan.ts';
import { unshelveWork } from './shelve.ts';
import { slowGate } from './slow.ts';
import { forgetSpec, specFiles } from './spec.ts';
import { brokenStatus, closedStage, closeStage } from './stage-close.ts';
import {
  closedStageBranch,
  isOwnerTask,
  missingQueueTasks,
  selectTask,
  statusBranch,
  taskBlock,
  taskMark,
} from './stage-file.ts';
import { loadState } from './state.ts';
import { processTask, resumePrompt } from './tasks.ts';

export { type AgentConfig } from './context.ts';
export {
  defaultRunCommand,
  quoteWindowsArgument,
  type CommandResult,
  type RunCommand,
} from './process.ts';

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

/** Убирает память задачи, которую ведущая сессия уже закрыла и опубликовала во время остановки цикла. */
async function reconcileExternallyCompletedTask(context: LoopContext): Promise<void> {
  const { activeTask } = context.state;
  if (activeTask?.remoteBase === undefined) return;
  const stage = await readStage(context.config.root);
  if (taskMark(stage.stageText, activeTask.task) !== 'x') return;
  const local = await head(context.git);
  const remote = await remoteHead(context.git);
  if (local !== remote || activeTask.remoteBase === remote) return;
  delete context.state.activeTask;
  delete context.state.parked;
  delete context.state.resume;
  delete context.state.resumeNote;
  delete context.state.waitingAnswer;
  await forgetSpec(context, activeTask.task);
  await save(context);
  context.config.board?.end(MAIN_AGENT, `${activeTask.task}: внешнее завершение принято`);
  await context.say(`${activeTask.task}: закрытая и опубликованная задача удалена из памяти цикла`);
}

/** Один шаг: Issue, закрытый этап или задача очереди. */
async function tick(context: LoopContext): Promise<Step> {
  const { config, git, state } = context;
  if (state.retryAfter !== undefined) {
    if (state.retryAfter > config.now()) return 'idle';
    // Пауза кончилась: без удаления каждое ожидание считало бы её снова истёкшей и сразу будило цикл.
    await endPause(context);
  }
  const status = await readStatus(config.root);
  const branch = await currentBranch(git);
  const expected = statusBranch(status);
  if (expected !== undefined && branch !== expected)
    return park(context, 'branch', `ожидалась ветка ${expected} из STATUS, сейчас ${branch}`);
  const files = await dirtyFiles(git);
  if (files !== '') return dirtyTree(context, files);
  const currentStage = await readStage(config.root);
  const missing =
    closedStageBranch(status) === undefined
      ? missingQueueTasks(status, currentStage.stageText)
      : [];
  if (missing.length > 0)
    return park(
      context,
      `stage-queue:${currentStage.stage}`,
      `в этапе нет отдельных заголовков задач очереди: ${missing.join(', ')}`,
    );
  await reconcileExternallyCompletedTask(context);
  // Доделка имеет смысл только для незакоммиченной работы: в чистом дереве её не продолжать
  // позже на чужих файлах (например, весах, которые пишет evolve владельца).
  if (state.resume !== undefined || state.waitingAnswer !== undefined) {
    delete state.resume;
    delete state.waitingAnswer;
    await save(context);
  }
  const { parked } = state;
  if (parked && !selfClearing(parked.key) && parked.head === (await head(git))) {
    const issue = await processIssues(context, false);
    return issue ?? park(context, parked.key, parked.reason);
  }
  // Локальные коммиты активной задачи нельзя push-ить до финального review.
  if (state.activeTask !== undefined)
    return (
      await processTask(context, state.activeTask.task, {
        mark: taskMark((await readStage(config.root)).stageText, state.activeTask.task) ?? ' ',
        workPrompt: `$task ${state.activeTask.task}`,
      })
    ).step;
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return park(context, 'sync', unsynced);
  // Ветка, дерево и синхронизация в порядке: их ожидание снято.
  await settleWait(context, (key) => !key.startsWith('slow:'));
  const issue = await processIssues(context, false);
  if (issue !== undefined) return issue;
  const broken = await brokenStatus(context);
  if (broken !== undefined) return broken;
  const stage = await readStage(config.root);
  const closed = closedStageBranch(stage.status);
  if (closed !== undefined) return closedStage(context, closed);
  const slow = await slowGate(context);
  if (slow !== undefined) return slow;
  const selected = await selectPlannedTask(context, stage);
  if (selected === undefined) return closeStage(context, await readStage(config.root));
  if (typeof selected === 'string') return selected;
  const { task, mark, workPrompt } = selected;
  const fresh = await readStage(config.root);
  const block = taskBlock(fresh.stageText, task);
  if (isOwnerTask(block))
    return park(
      context,
      `owner:${task}`,
      `очередь дошла до ${task} — это задача владельца. Когда сделаешь — Issue «$done ${task}» с текстом, что сделано`,
      firstLine(block),
    );
  await context.say(`задача ${task} [${mark}]`);
  return (await processTask(context, task, { mark, workPrompt })).step;
}

/**
 * Ожидание работы без нагрузки: раз в pollSeconds — условный запрос к GitHub (ответ 304
 * не тратит лимит API, git и codex не запускаются), полный шаг — при изменении Issues
 * или `main`, по Enter в консоли, по окончании паузы после сбоя или раз в pollMinutes.
 */
async function waitForWork(context: LoopContext): Promise<void> {
  const { config, state } = context;
  const deadline = config.now() + config.pollMinutes * 60_000;
  const github = config.github;
  // Сбой сети или токена повторяется каждые pollSeconds: в протокол — только новый текст ошибки.
  let lastError = '';
  const check = async (): Promise<boolean> => {
    if (state.parked && state.parked.head !== (await head(context.git))) return true;
    try {
      const changed = github !== undefined && (await github.changed());
      lastError = '';
      return changed;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text !== lastError) await context.say(`GitHub: проверка не удалась — ${text}`);
      lastError = text;
      return false;
    }
  };
  // Первая проверка тоже будит: Issue могла появиться между шагом и началом ожидания.
  if (await check()) return;
  while (config.now() < deadline) {
    if ((await config.sleep(config.pollSeconds * 1000)) === 'wake') return;
    if (state.retryAfter !== undefined && state.retryAfter <= config.now()) return;
    if (await check()) {
      await context.say('изменения в Issues или main — проверяю');
      return;
    }
  }
}

/** План без запуска codex: что цикл сделал бы сейчас. */
async function describe(context: LoopContext): Promise<void> {
  const { config } = context;
  const issues = config.github
    ? await config.github.listIssues().catch((error: unknown) => {
        config.writeLine(`GitHub: Issues не прочитаны — ${String(error)}`);
        return [];
      })
    : [];
  for (const issue of issues) {
    if (
      issue.labels.includes(STOP_LABEL) ||
      issue.author.toLowerCase() !== config.github?.owner.toLowerCase()
    )
      continue;
    const command = parseIssueCommand(issue.body);
    config.writeLine(
      `Issue #${issue.number}: ${'error' in command ? `ошибка — ${command.error}` : firstLine(command.prompt)}`,
    );
  }
  const stage = await readStage(config.root);
  const closed = closedStageBranch(stage.status);
  const task = selectTask(stage.status, stage.stageText);
  if (closed !== undefined) config.writeLine(`этап закрыт: жду мерж ${closed}`);
  else if (task === undefined) config.writeLine('$stage-close');
  else if (isOwnerTask(taskBlock(stage.stageText, task)))
    config.writeLine(`задача владельца: ${task}`);
  else
    config.writeLine(
      `${
        taskMark(stage.stageText, task) === '~'
          ? '$review'
          : planEnabled(context)
            ? '$next → plan → $task → CI → $review'
            : '$next → CI → $review'
      }: ${task}`,
    );
}

export async function runAgentLoop(config: AgentConfig): Promise<number> {
  const context: LoopContext = {
    config,
    definitions: await loadAgentDefinitions(config.root),
    git: makeGit(config.runCommand, config.root),
    state: await loadState(config.root),
    say: await openLog(config),
  };
  if (config.board !== undefined) config.board.limit = () => 1;
  if (config.dryRun) {
    await describe(context);
    return 0;
  }
  // Ожидание активной задачи переживает перезапуск: повтор роли разрешает только новый коммит.
  // Ожидания вне задачи владелец по-прежнему может повторить простым перезапуском цикла.
  if (context.state.activeTask === undefined) delete context.state.parked;
  delete context.state.retryAfter;
  if (config.resume !== undefined) context.state.resume = config.resume;
  await save(context);
  await recoverShelved(context);
  if (config.streams !== undefined && config.streams !== context.state.streams) {
    context.state.streams = config.streams;
    await save(context);
  }
  context.state.streams = 1;
  await save(context);
  await context.say(
    `старт: последовательный режим в ветке этапа, Issues ${config.github ? `${config.github.repo}, метка agent` : 'не читаются (нет GITHUB_TOKEN)'}`,
  );
  return runSingle(context);
}

/** Цикл оборвался, пока работа задачи была отложена на время Issue: она возвращается в дерево. */
async function recoverShelved(context: LoopContext): Promise<void> {
  const back = await unshelveWork(context);
  if (back.kind === 'none') return;
  if (back.kind === 'refused') {
    await context.say(`работа ${back.task} не вернулась из git stash: ${back.reason}`);
    return;
  }
  await context.say(`работа ${back.task} возвращена из git stash после обрыва цикла`);
}

/** Цикл по одной задаче в ветке этапа. */
async function runSingle(context: LoopContext): Promise<number> {
  const { config } = context;
  let waiting = false;
  for (;;) {
    let step: Step;
    try {
      step = await tick(context);
    } catch (error) {
      await context.say(`ошибка: ${error instanceof Error ? error.message : String(error)}`);
      if (config.once) return 1;
      step = 'idle';
    }
    if (step === 'worked') {
      waiting = false;
      continue;
    }
    if (config.once) {
      await context.say('итог: работы без владельца нет');
      return 0;
    }
    if (!waiting) {
      // Ожидание владельца уже на панели со своей причиной: её не заменить общей строкой.
      if (context.state.parked === undefined && context.state.retryAfter === undefined)
        config.board?.end(MAIN_AGENT, 'нет работы — жду Issues и main');
      await context.say(
        `… жду: Issues и main проверяю раз в ${config.pollSeconds} с, Enter — проверить сейчас`,
      );
    }
    waiting = true;
    await waitForWork(context);
  }
}
