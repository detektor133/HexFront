// Конец этапа: `$stage-close` при пустой очереди, PR в main, после мержа — ветка следующего этапа.
import {
  park,
  readStage,
  readStatus,
  runSkill,
  STATUS_FORMAT,
  save,
  type LoopContext,
  type StageState,
  type Step,
} from './context.ts';
import { currentBranch, head, mergedIntoMain } from './git.ts';
import { parseGithubRepo } from './github.ts';
import { slowBeforeClose } from './slow.ts';
import { closedStageBranch, openTasks, statusBranch, statusStage } from './stage-file.ts';
import { skillFailed } from './tasks.ts';

/**
 * STATUS без строки «Текущий этап»: ожидание с понятной причиной до коммита, который его
 * исправит (Issue `$decide` или правка владельца), вместо ошибки на каждом шаге.
 */
export async function brokenStatus(context: LoopContext): Promise<Step | undefined> {
  if (statusStage(await readStatus(context.config.root)) !== undefined) return undefined;
  return park(context, 'status', `STATUS не читается: ${STATUS_FORMAT}`);
}

/** Очередь пуста: этап закрывается, только если в файле этапа не осталось `[ ]` и `[~]`. */
export async function closeStage(context: LoopContext, stage: StageState): Promise<Step> {
  const open = openTasks(stage.stageText, stage.stage);
  if (open.length > 0)
    return park(
      context,
      `queue:${stage.stage}`,
      `в очереди нет открытых задач, а в этапе ${stage.stage} открыты ${open.join(', ')} — нужна Issue $decide с очередью`,
    );
  const slow = await slowBeforeClose(context);
  if (slow !== undefined) return slow;
  await context.say(`этап ${stage.stage}: все задачи закрыты — $stage-close`);
  const result = await runSkill(context, 'next', '$stage-close');
  if (!result.ok) return skillFailed(context, '$stage-close', result);
  const status = await readStatus(context.config.root);
  // 2026-10-14: сессия переписала таблицу STATUS по-своему, и цикл больше не находил этап.
  if (statusStage(status) === undefined || statusBranch(status) === undefined)
    return park(
      context,
      `close:${stage.stage}`,
      `$stage-close записал STATUS не по шаблону: ${STATUS_FORMAT}`,
      result.message,
    );
  // Без смены «Текущего этапа» следующий шаг снова закрыл бы тот же этап.
  if (closedStageBranch(status) === undefined)
    return park(
      context,
      `close:${stage.stage}`,
      `$stage-close не перевёл «Текущий этап» в STATUS на следующий — проверь`,
      result.message,
    );
  return 'worked';
}

async function pullRequestLink(context: LoopContext, branch: string): Promise<string> {
  const known = context.state.pullRequests[branch];
  if (known !== undefined) return known;
  const { github } = context.config;
  const repo =
    github?.repo ?? parseGithubRepo(await context.git.run(['remote', 'get-url', 'origin']));
  const compare = `https://github.com/${repo}/compare/main...${branch}?expand=1`;
  if (!github) return `${compare} (создай PR сам)`;
  try {
    const url = await github.openPullRequest(
      branch,
      'main',
      `Этап ${branch.replace('stage-', '')} закрыт`,
    );
    context.state.pullRequests[branch] = url;
    await save(context);
    await context.say(`открыт PR этапа: ${url}`);
    return url;
  } catch (error) {
    await context.say(
      `GitHub: PR не создан — ${error instanceof Error ? error.message : String(error)}`,
    );
    const manual = `${compare} (создай PR сам: у токена нет права Pull requests)`;
    context.state.pullRequests[branch] = manual;
    await save(context);
    return manual;
  }
}

/**
 * Этап закрыт: до мержа PR — ожидание владельца, после мержа `$stage-close` выполняет
 * свой шаг 7 (ветка следующего этапа от main и поле «Ветка»).
 */
export async function closedStage(context: LoopContext, branch: string): Promise<Step> {
  const { parked } = context.state;
  // После неудачного шага 7 не запускать $stage-close заново, пока не появится новый коммит.
  if (
    parked !== undefined &&
    /^(skill:\$stage-close|next-branch:)/.test(parked.key) &&
    parked.head === (await head(context.git))
  )
    return 'idle';
  if (!(await mergedIntoMain(context.git)))
    return park(
      context,
      `merge:${branch}`,
      `этап закрыт, PR ${await pullRequestLink(context, branch)} — нажми Merge, ветку следующего этапа цикл создаст сам`,
    );
  await context.say(`PR ${branch} смёржен — $stage-close создаёт ветку следующего этапа`);
  const result = await runSkill(context, 'next', '$stage-close');
  if (!result.ok) return skillFailed(context, '$stage-close', result);
  const { status } = await readStage(context.config.root);
  const current = await currentBranch(context.git);
  if (closedStageBranch(status) !== undefined || statusBranch(status) !== current)
    return park(
      context,
      `next-branch:${branch}`,
      `после $stage-close ветка ${current}, а в STATUS «Ветка» ${statusBranch(status) ?? '—'} — проверь`,
      result.message,
    );
  await context.say(`новый этап: ветка ${current}`);
  return 'worked';
}
