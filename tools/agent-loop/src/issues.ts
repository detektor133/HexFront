// Issue с меткой `agent` от владельца репозитория — конверт команды: первая строка — скилл, дальше текст дословно.
import { USAGE_LIMIT } from './codex.ts';
import {
  backoff,
  firstLine,
  lastLines,
  readStage,
  runSkill,
  save,
  type LoopContext,
  type Step,
} from './context.ts';
import { head } from './git.ts';
import { parseIssueCommand, STOP_LABEL, type AgentIssue, type IssueCommand } from './github.ts';
import { taskMark } from './stage-file.ts';
import { processTask } from './tasks.ts';

/** Второй сбой codex на одной Issue снимает её с очереди меткой `agent-stop`. */
const MAX_ISSUE_FAILURES = 2;
/** Сколько исполненная Issue не берётся снова в прежнем виде, мс: дольше список GitHub не отстаёт. */
const RECENT_MS = 10 * 60_000;

/** GitHub недоступен — цикл не падает: строка в протокол, работа по очереди продолжается. */
async function safely(
  context: LoopContext,
  what: string,
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    await context.say(
      `GitHub: ${what} не удалось — ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Ответ на Issue дан. Список GitHub ещё секунды показывает её открытой и без метки, поэтому
 * Issue в том же виде (`updated_at`) не берётся снова; не принятые GitHub закрытие или метка
 * запоминают её насовсем.
 */
async function answered(
  context: LoopContext,
  issue: AgentIssue,
  delivered: boolean,
): Promise<void> {
  const { state, config } = context;
  const now = config.now();
  state.recentIssues = {
    ...Object.fromEntries(
      Object.entries(state.recentIssues).filter(([, recent]) => now - recent.at < RECENT_MS),
    ),
    [String(issue.number)]: { updatedAt: issue.updatedAt, at: now },
  };
  if (!delivered) state.answeredIssues.push(issue.number);
  await save(context);
}

const recentlyAnswered = (context: LoopContext, issue: AgentIssue): boolean => {
  const recent = context.state.recentIssues[String(issue.number)];
  return (
    recent !== undefined &&
    recent.updatedAt === issue.updatedAt &&
    context.config.now() - recent.at < RECENT_MS
  );
};

async function finish(context: LoopContext, issue: AgentIssue, text: string): Promise<Step> {
  const github = context.config.github;
  await context.say(`Issue #${issue.number}: ${text}`);
  const delivered =
    github !== undefined &&
    (await safely(context, `закрыть Issue #${issue.number}`, async () => {
      // Сначала закрытие: снимок списка с новым updated_at уже не покажет Issue открытой.
      await github.close(issue.number);
      await github.comment(issue.number, text);
    }));
  await answered(context, issue, delivered);
  return 'worked';
}

async function stopIssue(
  context: LoopContext,
  issue: AgentIssue,
  reason: string,
  answer = '',
): Promise<Step> {
  const github = context.config.github;
  // Снятая владельцем agent-stop даёт Issue снова две попытки.
  context.state.issueFailures[String(issue.number)] = 0;
  await save(context);
  await context.say(`Issue #${issue.number}: стоп — ${reason}`);
  const tail = answer.trim() === '' ? '' : `\n\n\`\`\`\n${lastLines(answer, 15)}\n\`\`\``;
  const delivered =
    github !== undefined &&
    (await safely(context, `ответить в Issue #${issue.number}`, async () => {
      await github.addLabel(issue.number, STOP_LABEL);
      await github.comment(
        issue.number,
        `стоп: ${reason}${tail}\n\nСними метку \`${STOP_LABEL}\`, чтобы цикл взял Issue снова.`,
      );
    }));
  await answered(context, issue, delivered);
  return 'worked';
}

/** Сбой codex: пауза и повтор позже, второй сбой — `agent-stop`. */
async function issueCrashed(
  context: LoopContext,
  issue: AgentIssue,
  reason: string,
  answer: string,
): Promise<Step> {
  // Кончившийся лимит — не вина Issue: только пауза, попытка не тратится.
  if (reason === USAGE_LIMIT) return backoff(context, `Issue #${issue.number}: ${reason}`, answer);
  const key = String(issue.number);
  const failures = (context.state.issueFailures[key] ?? 0) + 1;
  context.state.issueFailures[key] = failures;
  await save(context);
  if (failures >= MAX_ISSUE_FAILURES)
    return stopIssue(context, issue, `${reason} (${failures}-й раз)`, answer);
  return backoff(context, `Issue #${issue.number}: ${reason}`, answer);
}

/** `$task` и `$review` идут кругами задачи до `[x]`, как задачи очереди. */
async function runTaskIssue(
  context: LoopContext,
  issue: AgentIssue,
  command: IssueCommand,
  task: string,
): Promise<Step> {
  const mark = taskMark((await readStage(context.config.root)).stageText, task);
  if (mark === undefined)
    return stopIssue(context, issue, `задачи ${task} нет в файле текущего этапа`);
  if (mark === 'x' || mark === '—') return finish(context, issue, `${task} уже закрыта [${mark}]`);
  if (command.skill === 'review' && mark !== '~')
    return stopIssue(context, issue, `${task} не ждёт ревью (отметка [${mark}])`);
  const run = await processTask(context, task, { mark, workPrompt: `$task ${task}` });
  if (run.done)
    return finish(
      context,
      issue,
      `выполнено: ${task} [x], HEAD ${(await head(context.git)).slice(0, 7)}`,
    );
  if ((context.state.retryAfter ?? 0) > context.config.now())
    return issueCrashed(context, issue, 'сбой codex', '');
  const { parked } = context.state;
  const current = await head(context.git);
  return stopIssue(
    context,
    issue,
    parked?.head === current ? parked.reason : `${task} не закрыта, см. консоль цикла`,
  );
}

/** `$streams N`: предел одновременных задач; режим цикла меняется в ближайшей свободной точке. */
async function setStreams(context: LoopContext, issue: AgentIssue, count: number): Promise<Step> {
  const before = context.state.streams ?? 1;
  context.state.streams = count;
  await save(context);
  return finish(
    context,
    issue,
    count === 1
      ? `один агент (было ${before}): новые задачи — по одной в главном каталоге; задачи, уже начатые в потоках, доделываются там`
      : `до ${count} задач одновременно (было ${before}): цикл сам берёт рядом только задачи без пересечений по «Файлы:» и «После:», остальные идут по одной`,
  );
}

async function runIssue(
  context: LoopContext,
  issue: AgentIssue,
  command: IssueCommand,
): Promise<Step> {
  await context.say(`Issue #${issue.number} «${issue.title}»: ${firstLine(command.prompt)}`);
  if (command.skill === 'streams' && command.count !== undefined)
    return setStreams(context, issue, command.count);
  if ((command.skill === 'task' || command.skill === 'review') && command.task !== undefined)
    return runTaskIssue(context, issue, command, command.task);
  const result = await runSkill(context, 'next', command.prompt);
  if (result.ok)
    return finish(
      context,
      issue,
      `выполнено: коммит ${result.sha.slice(0, 7)} — ${firstLine(result.message)}`,
    );
  if (result.codexFailed) return issueCrashed(context, issue, result.reason, result.message);
  return stopIssue(context, issue, result.reason, result.message);
}

/**
 * Берёт самую старую Issue владельца с меткой `agent` без `agent-stop`. При грязном дереве
 * (идёт работа владельца) исполняется только `$done`: он и коммитит эту работу.
 * @returns шаг цикла или undefined, если Issue для исполнения нет.
 */
export async function processIssues(
  context: LoopContext,
  dirty: boolean,
): Promise<Step | undefined> {
  const github = context.config.github;
  if (!github) return undefined;
  let issues: readonly AgentIssue[] = [];
  await safely(context, 'прочитать Issues', async () => {
    issues = await github.listIssues();
  });
  for (const issue of issues) {
    if (
      issue.labels.includes(STOP_LABEL) ||
      issue.author.toLowerCase() !== github.owner.toLowerCase() ||
      context.state.answeredIssues.includes(issue.number) ||
      recentlyAnswered(context, issue)
    )
      continue;
    const command = parseIssueCommand(issue.body);
    // `$done` коммитит работу владельца, `$streams` — настройка цикла: обоим чистое дерево не нужно.
    if (dirty && !('error' in command) && command.skill !== 'done' && command.skill !== 'streams')
      continue;
    // Перед исполнением — состояние Issue прямым запросом: отстающий список мог отдать уже
    // закрытую или остановленную Issue (2026-10-14: #12 исполнилась второй раз через 4 с).
    let fresh: AgentIssue | undefined;
    if (
      !(await safely(context, `проверить Issue #${issue.number}`, async () => {
        fresh = await github.openIssue(issue.number);
      }))
    )
      return undefined;
    if (fresh === undefined || fresh.labels.includes(STOP_LABEL)) continue;
    if ('error' in command) return stopIssue(context, issue, command.error);
    return runIssue(context, issue, command);
  }
  return undefined;
}
