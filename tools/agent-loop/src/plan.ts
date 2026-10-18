// Роль `plan`: проверка текста задачи перед исполнителем, между выбором задачи ($next) и работой
// ($task). Правит только файл этапа, STATUS, QUESTIONS и DECISIONS — права узкие, как у reviewer;
// код продукта и сам цикл (tools/agent-loop/**) она не видит и не трогает.
// 2026-10-17: предложение владельца «роль plan» — 07/T22 задача без названных файлов заодно
// отредактировала код самого цикла, 07/T17e неизмеримый критерий «минимальное перекрытие карты»
// три круга подряд рождал новый обход теста. Проверка текста задачи до круга исполнителя снимает
// часть таких случаев заранее.
import {
  backoff,
  checkPermissions,
  park,
  readStage,
  save,
  session,
  type LoopContext,
  type StageState,
  type Step,
} from './context.ts';
import { dirtyFiles, head, syncWithOrigin } from './git.ts';
import { verifyPlanTransition } from './requirements.ts';
import { isOwnerTask, selectTask, taskBlock, taskMark, type TaskMark } from './stage-file.ts';

/** Без роли plan в roles.json цикл работает по-старому: текст задачи перед работой не проверяется. */
export const planEnabled = (context: LoopContext): boolean =>
  context.definitions.roles.plan !== undefined;

export const planPrompt = (task: string): string => `$plan ${task}`;

/** Первая строка ответа `plan`: что сделано с текстом задачи (см. `.agents/skills/plan/SKILL.md`). */
// Без \b: в JS \b считает границу по [A-Za-z0-9_], кириллица — не «словесный» символ, и граница
// после последней кириллической буквы (конец слова → конец строки, оба «несловесные») не находится.
const OUTCOME_RE = /^PLAN:\s*(не трогал|уточнено|разбито|вопрос)(?![а-яё])/imu;

/** `blocked` — вопрос записан в `docs/QUESTIONS.md`, задачу исполнителю передавать нельзя. */
export interface PlanOutcome {
  readonly blocked: boolean;
}

/**
 * Одна сессия `plan` над задачей очереди.
 * @returns шаг цикла при остановке, или исход: можно передавать задачу `$task` дальше или нет.
 */
export async function runPlan(context: LoopContext, task: string): Promise<PlanOutcome | Step> {
  const { git, definitions } = context;
  const base = await head(git);
  const before = await readStage(context.config.root);
  const result = await session(context, 'plan', planPrompt(task));
  if (result.failure !== undefined)
    return backoff(context, `$plan ${task}: ${result.failure}`, result.message);
  if ((await dirtyFiles(git)) !== '')
    return park(
      context,
      `plan:${task}`,
      `$plan ${task} оставил незакоммиченные файлы — проверь`,
      result.message,
    );
  if (!(await checkPermissions(context, base, definitions.planPaths)))
    return park(
      context,
      `plan:${task}`,
      `$plan ${task} вышел за свои права (изменил файлы вне permissions.json) — проверь коммит`,
      result.message,
    );
  const unsynced = await syncWithOrigin(git, true);
  if (unsynced !== undefined) return park(context, `sync:${task}`, unsynced);
  const outcome = OUTCOME_RE.exec(result.message)?.[1];
  if (outcome === undefined)
    return park(
      context,
      `plan:${task}`,
      `$plan ${task} не ответил строкой «PLAN: …» — проверь`,
      result.message,
    );
  const after = await readStage(context.config.root);
  const errors = verifyPlanTransition(task, before, after, outcome);
  if (errors.length > 0)
    return park(
      context,
      `requirements:${task}`,
      `$plan ${task}: сверка требований не пройдена (${errors.length}): ${errors.slice(0, 3).join(' | ')}`,
      result.message,
    );
  await context.say(`$plan ${task}: ${outcome}`);
  return { blocked: outcome === 'вопрос' };
}

export interface PlannedQueueTask {
  readonly task: string;
  readonly mark: TaskMark;
  /** `$task <task>` — задачу уже выбрал и проверил plan, `$next` сам выбирает — он же работал. */
  readonly workPrompt: string;
}

/** Заблокированные задачи, чей снимок в `planBlocked` ещё совпадает с текущим блоком — текст не менялся. */
const blockedTasks = (stage: StageState, planBlocked: Readonly<Record<string, string>>): string[] =>
  Object.entries(planBlocked)
    .filter(([task, snapshot]) => taskBlock(stage.stageText, task) === snapshot)
    .map(([task]) => task);

/**
 * Задача очереди перед работой: `plan` проверяет её текст один раз для каждой свежей задачи
 * (отметка ` `), прежде чем она уйдёт исполнителю. Разбирается в `tick()` между выбором `$next`
 * и запуском `$task`. Задача, которую `plan` заблокировал вопросом, пропускается — цикл берёт
 * следующую незаблокированную задачу очереди, а не ждёт владельца на месте.
 * @returns выбранную задачу и промпт работы, шаг цикла при остановке, или undefined — очередь пуста.
 */
export async function selectPlannedTask(
  context: LoopContext,
  initialStage: StageState,
): Promise<PlannedQueueTask | Step | undefined> {
  const { state, config } = context;
  let stage = initialStage;
  for (;;) {
    const task = selectTask(stage.status, stage.stageText, blockedTasks(stage, state.planBlocked));
    if (task === undefined) {
      if (selectTask(stage.status, stage.stageText) === undefined) return undefined;
      return park(
        context,
        'plan-blocked',
        'все задачи очереди ждут ответа владельца на вопрос plan в docs/QUESTIONS.md',
      );
    }
    const mark = taskMark(stage.stageText, task) ?? ' ';
    // Задача владельца не уходит исполнителю: plan её не проверяет, tick() сам ждёт владельца.
    if (mark !== ' ' || !planEnabled(context) || isOwnerTask(taskBlock(stage.stageText, task)))
      return { task, mark, workPrompt: '$next' };
    const planned = await runPlan(context, task);
    if (typeof planned === 'string') return planned;
    stage = await readStage(config.root);
    if (!planned.blocked) {
      // plan мог уточнить или разбить задачу: заново выбираем первую задачу очереди по свежему
      // тексту, а не слепо продолжаем со старым номером (после разбиения его может не быть).
      const next =
        selectTask(stage.status, stage.stageText, blockedTasks(stage, state.planBlocked)) ?? task;
      return {
        task: next,
        mark: taskMark(stage.stageText, next) ?? ' ',
        workPrompt: `$task ${next}`,
      };
    }
    state.planBlocked = { ...state.planBlocked, [task]: taskBlock(stage.stageText, task) };
    await save(context);
  }
}
