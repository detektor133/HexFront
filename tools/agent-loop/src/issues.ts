// Issue с меткой `agent` от владельца репозитория — конверт команды: первая строка — скилл, дальше текст дословно.
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

/** GitHub не принял закрытие или метку: Issue запоминается, чтобы не исполнить её второй раз. */
async function answered(
  context: LoopContext,
  issue: AgentIssue,
  delivered: boolean,
): Promise<void> {
  if (delivered) return;
  context.state.answeredIssues.push(issue.number);
  await save(context);
}

async function finish(context: LoopContext, issue: AgentIssue, text: string): Promise<Step> {
  const github = context.config.github;
  await context.say(`Issue #${issue.number}: ${text}`);
  const delivered =
    github !== undefined &&
    (await safely(context, `закрыть Issue #${issue.number}`, async () => {
      await github.comment(issue.number, text);
      await github.close(issue.number);
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
  await context.say(`Issue #${issue.number}: стоп — ${reason}`);
  const tail = answer.trim() === '' ? '' : `\n\n\`\`\`\n${lastLines(answer, 15)}\n\`\`\``;
  const delivered =
    github !== undefined &&
    (await safely(context, `ответить в Issue #${issue.number}`, async () => {
      await github.comment(
        issue.number,
        `стоп: ${reason}${tail}\n\nСними метку \`${STOP_LABEL}\`, чтобы цикл взял Issue снова.`,
      );
      await github.addLabel(issue.number, STOP_LABEL);
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

async function runIssue(
  context: LoopContext,
  issue: AgentIssue,
  command: IssueCommand,
): Promise<Step> {
  await context.say(`Issue #${issue.number} «${issue.title}»: ${firstLine(command.prompt)}`);
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
      issue.author !== github.owner ||
      context.state.answeredIssues.includes(issue.number)
    )
      continue;
    const command = parseIssueCommand(issue.body);
    if ('error' in command) return stopIssue(context, issue, command.error);
    if (dirty && command.skill !== 'done') continue;
    return runIssue(context, issue, command);
  }
  return undefined;
}
