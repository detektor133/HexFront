// Агентный цикл: Issues владельца → «Очередь» этапа → закрытие этапа; без работы ждёт новых Issues.
import { loadAgentDefinitions } from './codex.ts';
import {
  firstLine,
  openLog,
  park,
  readStage,
  save,
  type AgentConfig,
  type LoopContext,
  type Step,
} from './context.ts';
import { currentBranch, dirtyFiles, head, makeGit, syncWithOrigin } from './git.ts';
import { parseIssueCommand, STOP_LABEL } from './github.ts';
import { processIssues } from './issues.ts';
import { slowGate } from './slow.ts';
import { closedStage, closeStage } from './stage-close.ts';
import {
  closedStageBranch,
  isOwnerTask,
  selectTask,
  statusBranch,
  taskBlock,
  taskMark,
} from './stage-file.ts';
import { loadState } from './state.ts';
import { processTask } from './tasks.ts';

export { type AgentConfig } from './context.ts';
export {
  defaultRunCommand,
  prepareProcessArguments,
  quoteWindowsArgument,
  type CommandResult,
  type RunCommand,
} from './process.ts';

/** Ожидания, которые снимаются сами, без нового коммита: их проверка повторяется каждый шаг. */
const SELF_CLEARING = /^(dirty|branch|sync)$/;

/** Грязное дерево: доделка своей задачи, `$done` владельца или ожидание. */
async function dirtyTree(context: LoopContext, files: string): Promise<Step> {
  const { state, config } = context;
  if (state.resume !== undefined) {
    const mark = taskMark((await readStage(config.root)).stageText, state.resume) ?? ' ';
    return (await processTask(context, state.resume, { mark, workPrompt: '$next', resume: true }))
      .step;
  }
  const issue = await processIssues(context, true);
  if (issue !== undefined) return issue;
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

/** Один шаг: Issue, закрытый этап или задача очереди. */
async function tick(context: LoopContext): Promise<Step> {
  const { config, git, state } = context;
  if (state.retryAfter !== undefined) {
    if (state.retryAfter > config.now()) return 'idle';
    // Пауза кончилась: без удаления каждое ожидание считало бы её снова истёкшей и сразу будило цикл.
    delete state.retryAfter;
    await save(context);
  }
  const { status } = await readStage(config.root);
  const branch = await currentBranch(git);
  const expected = statusBranch(status);
  if (expected !== undefined && branch !== expected)
    return park(context, 'branch', `ожидалась ветка ${expected} из STATUS, сейчас ${branch}`);
  const files = await dirtyFiles(git);
  if (files !== '') return dirtyTree(context, files);
  // Доделка имеет смысл только для незакоммиченной работы: в чистом дереве её не продолжать
  // позже на чужих файлах (например, весах, которые пишет evolve владельца).
  if (state.resume !== undefined) {
    delete state.resume;
    await save(context);
  }
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return park(context, 'sync', unsynced);
  const issue = await processIssues(context, false);
  if (issue !== undefined) return issue;
  const stage = await readStage(config.root);
  const closed = closedStageBranch(stage.status);
  if (closed !== undefined) return closedStage(context, closed);
  const { parked } = state;
  if (parked && !SELF_CLEARING.test(parked.key) && parked.head === (await head(git))) return 'idle';
  const slow = await slowGate(context);
  if (slow !== undefined) return slow;
  const task = selectTask(stage.status, stage.stageText);
  if (task === undefined) return closeStage(context, stage);
  const block = taskBlock(stage.stageText, task);
  if (isOwnerTask(block))
    return park(
      context,
      `owner:${task}`,
      `очередь дошла до ${task} — это задача владельца. Когда сделаешь — Issue «$done ${task}» с текстом, что сделано`,
      firstLine(block),
    );
  const mark = taskMark(stage.stageText, task) ?? ' ';
  await context.say(`задача ${task} [${mark}]`);
  return (await processTask(context, task, { mark, workPrompt: '$next' })).step;
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
      `${taskMark(stage.stageText, task) === '~' ? '$review' : '$next → CI → $review'}: ${task}`,
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
  if (config.dryRun) {
    await describe(context);
    return 0;
  }
  // Перезапуск цикла владельцем — повторить ожидание и паузу после сбоя сразу, а не ждать коммита.
  delete context.state.parked;
  delete context.state.retryAfter;
  if (config.resume !== undefined) context.state.resume = config.resume;
  await save(context);
  await context.say(
    `старт: кругов на задачу ≤ ${config.maxRounds}, Issues ${config.github ? `${config.github.repo}, метка agent` : 'не читаются (нет GITHUB_TOKEN)'}`,
  );
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
    if (!waiting)
      await context.say(
        `… жду: Issues и main проверяю раз в ${config.pollSeconds} с, Enter — проверить сейчас`,
      );
    waiting = true;
    await waitForWork(context);
  }
}
