// Роль `plan`: проверка текста задачи перед исполнителем, между выбором задачи ($next) и работой
// ($task). Правит только файл этапа, STATUS, QUESTIONS и DECISIONS — права узкие, как у reviewer;
// код продукта и сам цикл (tools/agent-loop/**) она не видит и не трогает.
// 2026-10-17: предложение владельца «роль plan» — 07/T22 задача без названных файлов заодно
// отредактировала код самого цикла, 07/T17e неизмеримый критерий «минимальное перекрытие карты»
// три круга подряд рождал новый обход теста. Проверка текста задачи до круга исполнителя снимает
// часть таких случаев заранее.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
import { changedPaths, dirtyFiles, head, remoteHead, syncWithOrigin } from './git.ts';
import { restoreMissingSplitParent, verifyPlanTransition } from './requirements.ts';
import { parsePlanMessage } from './role-output.ts';
import {
  isOwnerTask,
  parseQueue,
  selectTask,
  taskBlock,
  taskMark,
  type TaskMark,
} from './stage-file.ts';

/** Без роли plan в roles.json цикл работает по-старому: текст задачи перед работой не проверяется. */
export const planEnabled = (context: LoopContext): boolean =>
  context.definitions.roles.plan !== undefined;

export const planPrompt = (task: string, note = ''): string =>
  [`$plan ${task}`, note].filter(Boolean).join('\n');

/** Исход роли передаётся JSON-объектом, старый текстовый формат читается при миграции. */

/** `blocked` — вопрос записан в `docs/QUESTIONS.md`, задачу исполнителю передавать нельзя. */
export interface PlanOutcome {
  readonly blocked: boolean;
  readonly outcome:
    'не трогал' | 'уточнено' | 'разбито' | 'вопрос' | 'инфраструктура' | 'переделать';
  readonly detail?: string;
}

/**
 * Одна сессия `plan` над задачей очереди.
 * @returns шаг цикла при остановке, или исход: можно передавать задачу `$task` дальше или нет.
 */
export async function runPlan(
  context: LoopContext,
  task: string,
  note = '',
  originalBefore?: StageState,
): Promise<PlanOutcome | Step> {
  const { git, definitions } = context;
  const base = await head(git);
  const published = await remoteHead(git);
  const before = originalBefore ?? (await readStage(context.config.root));
  const result = await session(context, 'plan', planPrompt(task, note));
  if (result.failure !== undefined)
    return backoff(context, `$plan ${task}: ${result.failure}`, result.message);
  const dirty = (await dirtyFiles(git)) !== '';
  const paths = dirty ? await changedPaths(git) : [];
  if (
    dirty &&
    ((await head(git)) !== base ||
      paths.length === 0 ||
      paths.some(
        (path) =>
          !(
            path === before.path ||
            ['docs/STATUS.md', 'docs/QUESTIONS.md', 'docs/DECISIONS.md'].includes(path)
          ),
      ))
  )
    return park(
      context,
      `plan:${task}`,
      `$plan ${task} оставил незакоммиченные файлы — проверь`,
      result.message,
    );
  if ((await remoteHead(git)) !== published)
    return park(context, `push:${task}`, `$plan ${task} изменила origin до финального review`);
  if (!(await checkPermissions(context, base, definitions.planPaths)))
    return park(
      context,
      `plan:${task}`,
      `$plan ${task} вышел за свои права (изменил файлы вне permissions.json) — проверь коммит`,
      result.message,
    );
  const parsed = parsePlanMessage(result.message);
  let outcome = parsed?.outcome;
  const detail = parsed?.detail;
  // После возврата review plan лишь выбирает дальнейшую роль. Чистый ответ без изменения документов
  // не должен останавливать уже собранный пакет замечаний из-за пропущенного служебного хвоста.
  if (outcome === undefined && context.state.activeTask?.task === task) {
    outcome = 'не трогал';
    await context.say(
      `$plan ${task}: нет PLAN-маркера, документы не менялись — продолжаю пакет замечаний`,
    );
  }
  if (
    outcome === undefined ||
    ((outcome === 'инфраструктура' || outcome === 'переделать') && !detail)
  )
    return park(
      context,
      `plan:${task}`,
      `$plan ${task} не дал проверяемый исход — проверь`,
      result.message,
    );
  if (dirty && !['уточнено', 'разбито', 'вопрос'].includes(outcome))
    return park(context, `plan:${task}`, `$plan ${task} оставил незакоммиченные файлы — проверь`);
  let after = await readStage(context.config.root);
  if (outcome === 'разбито') {
    const repaired = restoreMissingSplitParent(task, before, after);
    if (repaired !== undefined) {
      await writeFile(join(context.config.root, after.path), repaired, 'utf8');
      await git.run(['add', '--', after.path]);
      if (!dirty) await git.run(['commit', '--amend', '--no-edit']);
      after = await readStage(context.config.root);
      await context.say(`$plan ${task}: восстановлен удалённый родитель разбиения`);
    }
  }
  const errors = verifyPlanTransition(task, before, after, outcome);
  if (
    errors.length > 0 &&
    outcome === 'разбито' &&
    originalBefore === undefined &&
    taskBlock(after.stageText, task) !== ''
  ) {
    await context.say(`$plan ${task}: разбиение не прошло сверку — возвращаю точные ошибки plan`);
    return runPlan(
      context,
      task,
      `Исправь уже записанное разбиение и верни outcome «разбито». Исходный блок родителя не меняй. Ошибки сверки:\n${errors.map((error) => `- ${error}`).join('\n')}`,
      before,
    );
  }
  if (errors.length > 0)
    return park(
      context,
      `requirements:${task}`,
      `$plan ${task}: сверка требований не пройдена (${errors.length}): ${errors.slice(0, 3).join(' | ')}`,
      result.message,
    );
  if (dirty) {
    const changed = await changedPaths(git);
    const added = await git.attempt(['add', '--', ...changed]);
    if (added.code !== 0)
      return park(
        context,
        `plan:${task}`,
        `$plan ${task}: не удалось подготовить коммит`,
        added.stderr,
      );
    const name = task.split('/').at(-1) ?? task;
    const title =
      outcome === 'разбито'
        ? `docs(docs): разделена задача ${name}`
        : outcome === 'вопрос'
          ? `docs(docs): записан вопрос по задаче ${name}`
          : `docs(docs): уточнена задача ${name}`;
    const committed = await git.attempt([
      'commit',
      '-m',
      title,
      '-m',
      `Этап: ${task.split('/')[0]}/infra`,
    ]);
    if (committed.code !== 0 || (await dirtyFiles(git)) !== '')
      return park(
        context,
        `plan:${task}`,
        `$plan ${task}: не удалось сохранить проверенные документы коммитом`,
        committed.stderr,
      );
    await context.say(`$plan ${task}: проверенные документы сохранены коммитом оркестратора`);
  }
  const unsynced = await syncWithOrigin(git, false);
  if (unsynced !== undefined) return park(context, `sync:${task}`, unsynced);
  await context.say(`$plan ${task}: ${outcome}`);
  return {
    blocked: outcome === 'вопрос',
    outcome,
    ...(detail === undefined ? {} : { detail }),
  };
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
 * и запуском `$task`. Задача, которую `plan` заблокировал вопросом, пропускается только ради
 * следующей автоматической задачи; задача владельца не выдаётся, пока перед ней есть блокеры.
 * @returns выбранную задачу и промпт работы, шаг цикла при остановке, или undefined — очередь пуста.
 */
export async function selectPlannedTask(
  context: LoopContext,
  initialStage: StageState,
): Promise<PlannedQueueTask | Step | undefined> {
  const { state, config } = context;
  let stage = initialStage;
  for (;;) {
    const blocked = blockedTasks(stage, state.planBlocked);
    const task = selectTask(stage.status, stage.stageText, blocked);
    if (task === undefined) {
      if (selectTask(stage.status, stage.stageText) === undefined) return undefined;
      return park(
        context,
        'plan-blocked',
        'все задачи очереди ждут ответа владельца на вопрос plan в docs/QUESTIONS.md',
      );
    }
    const mark = taskMark(stage.stageText, task) ?? ' ';
    if (isOwnerTask(taskBlock(stage.stageText, task))) {
      const queue = parseQueue(stage.status);
      const ownerIndex = queue.indexOf(task);
      const blockers = queue
        .slice(0, ownerIndex)
        .filter((candidate) => blocked.includes(candidate));
      if (blockers.length > 0)
        return park(
          context,
          'plan-blocked',
          `до ${task} очередь не дошла: ${blockers.join(', ')} ждут решений владельца в ` +
            'docs/QUESTIONS.md. Нажми Enter или B: варианты и свободный ввод',
        );
    }
    // Задача владельца не уходит исполнителю: plan её не проверяет, tick() сам ждёт владельца.
    if (mark !== ' ' || !planEnabled(context) || isOwnerTask(taskBlock(stage.stageText, task)))
      return { task, mark, workPrompt: `$task ${task}` };
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
        workPrompt:
          planned.outcome === 'инфраструктура'
            ? `$task ${next}\nСначала устрани технический блокер без участия владельца: ${planned.detail}`
            : `$task ${next}`,
      };
    }
    state.planBlocked = { ...state.planBlocked, [task]: taskBlock(stage.stageText, task) };
    await save(context);
  }
}
