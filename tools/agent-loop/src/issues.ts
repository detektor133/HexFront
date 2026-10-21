// Issue с меткой `agent` от владельца репозитория — конверт команды: первая строка — скилл, дальше текст дословно.
import { createHash } from 'node:crypto';

import { USAGE_LIMIT } from './codex.ts';
import {
  backoff,
  firstLine,
  lastLines,
  park,
  readStage,
  runSkill,
  save,
  type LoopContext,
  type Step,
} from './context.ts';
import { head } from './git.ts';
import {
  AGENT_LABEL,
  parseIssueCommand,
  STOP_LABEL,
  type AgentIssue,
  type IssueCommand,
} from './github.ts';
import { planEnabled, runPlan } from './plan.ts';
import { verifyDecisionTasks } from './requirements.ts';
import { shelveWork, unshelveWork } from './shelve.ts';
import { isOwnerTask, parseQueue, taskBlock, taskMark } from './stage-file.ts';
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

/** Не подтверждать результат устаревшей Issue: владелец мог изменить поручение во время сессии. */
async function stillCurrent(context: LoopContext, issue: AgentIssue): Promise<boolean> {
  const github = context.config.github;
  if (github === undefined) return false;
  let current: AgentIssue | undefined;
  const fetched = await safely(context, `повторно проверить Issue #${issue.number}`, async () => {
    current = await github.openIssue(issue.number);
  });
  if (!fetched) return false;
  const valid =
    current !== undefined &&
    current.body === issue.body &&
    current.author.toLowerCase() === github.owner.toLowerCase() &&
    current.labels.includes(AGENT_LABEL) &&
    !current.labels.includes(STOP_LABEL);
  if (!valid) {
    await context.say(
      `Issue #${issue.number}: поручение или метки изменились — старый результат не подтверждаю`,
    );
  }
  return valid;
}

async function finish(context: LoopContext, issue: AgentIssue, text: string): Promise<Step> {
  if (!(await stillCurrent(context, issue))) return 'worked';
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
  if (!(await stillCurrent(context, issue))) return 'worked';
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
  const initial = await readStage(context.config.root);
  let mark = taskMark(initial.stageText, task);
  if (mark === undefined)
    return stopIssue(context, issue, `задачи ${task} нет в файле текущего этапа`);
  if (mark === 'x' || mark === '—') return finish(context, issue, `${task} уже закрыта [${mark}]`);
  if (command.skill === 'review' && mark !== '~')
    return stopIssue(context, issue, `${task} не ждёт ревью (отметка [${mark}])`);
  // Issue с $task должна проходить тот же plan и spec, что задача обычной очереди.
  if (
    command.skill === 'task' &&
    mark === ' ' &&
    planEnabled(context) &&
    !isOwnerTask(taskBlock(initial.stageText, task))
  ) {
    const planned = await runPlan(context, task);
    if (typeof planned === 'string') return planned;
    if (planned.blocked)
      return stopIssue(context, issue, `$plan ${task} запросил решение владельца`);
    const fresh = await readStage(context.config.root);
    const nextMark = taskMark(fresh.stageText, task);
    // При разбиении $plan сохраняет родителя в файле, но заменяет его в очереди.
    // Нельзя исполнять $task родителя вместо новых подзадач.
    if (
      nextMark === undefined ||
      (parseQueue(initial.status).includes(task) && !parseQueue(fresh.status).includes(task))
    ) {
      return finish(
        context,
        issue,
        `${task} разбита планировщиком; дочерние задачи поставлены в очередь STATUS`,
      );
    }
    mark = nextMark;
  }
  // Текст владельца под командой — часть поручения: 2026-10-15, 07/T13 (#21) исполнитель получил
  // только `$task 07/T13` и не увидел, что первым делать живой фон меню.
  const workPrompt = command.skill === 'task' ? command.prompt : `$task ${task}`;
  const run = await processTask(context, task, { mark, workPrompt });
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
  const digest = createHash('sha256').update(issue.body).digest('hex');
  await context.say(
    `Issue #${issue.number} «${issue.title}»: ${firstLine(command.prompt)} (updated_at=${issue.updatedAt}, sha256=${digest})`,
  );
  if (command.skill === 'streams' && command.count !== undefined)
    return setStreams(context, issue, command.count);
  if ((command.skill === 'task' || command.skill === 'review') && command.task !== undefined)
    return runTaskIssue(context, issue, command, command.task);
  const result = await runSkill(
    context,
    command.skill === 'plan' ? 'plan' : 'next',
    command.prompt,
  );
  if (result.ok) {
    if (command.skill === 'decide') {
      const checked = verifyDecisionTasks(
        command.prompt,
        (await readStage(context.config.root)).stageText,
      );
      await context.say(`$decide Issue #${issue.number}: сверено ${checked.checked} пунктов`);
      if (checked.errors.length > 0)
        return stopIssue(
          context,
          issue,
          `сверка требований не пройдена (${checked.errors.length}): ${checked.errors.slice(0, 3).join(' | ')}`,
        );
    }
    return finish(
      context,
      issue,
      `выполнено: коммит ${result.sha.slice(0, 7)} — ${firstLine(result.message)}`,
    );
  }
  if (result.codexFailed) return issueCrashed(context, issue, result.reason, result.message);
  return stopIssue(context, issue, result.reason, result.message);
}

/** Ответы владельца на вопрос исполнителя: правят доки, а не код задачи. */
const ANSWERS: ReadonlySet<string> = new Set(['decide', 'bug']);

/**
 * Ответ владельца на вопрос исполнителя, пока работа задачи в дереве: работа откладывается,
 * Issue исполняется в чистом дереве, работа возвращается, задача продолжается с ответом.
 */
async function answerIssue(
  context: LoopContext,
  issue: AgentIssue,
  command: IssueCommand,
  task: string,
): Promise<Step> {
  if (!(await shelveWork(context, task)))
    return stopIssue(context, issue, `работу ${task} не удалось отложить, см. журнал цикла`);
  const before = await head(context.git);
  const step = await runIssue(context, issue, command);
  const back = await unshelveWork(context);
  if (back.kind === 'refused')
    return park(
      context,
      `shelf:${task}`,
      `работа ${task} не вернулась из git stash («${firstLine(back.reason)}») — она цела в git stash list, нужен владелец`,
    );
  // Ответа нет (сбой codex, стоп Issue): работа вернулась и по-прежнему ждёт владельца.
  if ((await head(context.git)) === before) return step;
  const { state } = context;
  delete state.waitingAnswer;
  delete state.parked;
  state.resume = task;
  state.resumeNote = `Пока работа ждала, владелец ответил Issue #${issue.number} (${firstLine(command.prompt)}): перечитай блок задачи и ответ.${
    back.kind === 'conflict'
      ? ` Работа вернулась с конфликтом слияния в ${back.files.join(', ')} — объедини изменения ответа и свои, затем git add.`
      : ''
  }`;
  await save(context);
  return step;
}

/**
 * Берёт самую старую Issue владельца с меткой `agent` без `agent-stop`. При грязном дереве
 * (идёт работа владельца) исполняется только `$done`: он и коммитит эту работу. Работа задачи,
 * которая ждёт ответа владельца (`waitingAnswer`), не мешает его ответу `$decide` или `$bug`.
 * @returns шаг цикла или undefined, если Issue для исполнения нет.
 */
export async function processIssues(
  context: LoopContext,
  dirty: boolean,
): Promise<Step | undefined> {
  const waiting = dirty ? context.state.waitingAnswer?.task : undefined;
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
    // Перед исполнением — состояние Issue прямым запросом: отстающий список мог отдать уже
    // закрытую или остановленную Issue (2026-10-14: #12 исполнилась второй раз через 4 с).
    let fresh: AgentIssue | undefined;
    if (
      !(await safely(context, `проверить Issue #${issue.number}`, async () => {
        fresh = await github.openIssue(issue.number);
      }))
    )
      return undefined;
    if (
      fresh === undefined ||
      !fresh.labels.includes(AGENT_LABEL) ||
      fresh.labels.includes(STOP_LABEL) ||
      fresh.author.toLowerCase() !== github.owner.toLowerCase()
    ) {
      continue;
    }
    // Команда и права читаются из свежей Issue, а не из потенциально устаревшего списка.
    const command = parseIssueCommand(fresh.body);
    const answer = !('error' in command) && waiting !== undefined && ANSWERS.has(command.skill);
    if (
      dirty &&
      !answer &&
      !('error' in command) &&
      command.skill !== 'done' &&
      command.skill !== 'streams'
    )
      continue;
    if ('error' in command) return stopIssue(context, fresh, command.error);
    return answer && waiting !== undefined
      ? answerIssue(context, fresh, command, waiting)
      : runIssue(context, fresh, command);
  }
  return undefined;
}
