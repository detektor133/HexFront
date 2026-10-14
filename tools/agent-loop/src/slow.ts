// Workflow `slow` (все тесты с тяжёлыми): цикл его не ждёт, но красный чинится первым,
// а этап закрывается только на зелёном.
import {
  park,
  settleWait,
  pollSlow,
  runSkill,
  save,
  waitSlow,
  type LoopContext,
  type Step,
} from './context.ts';
import { head } from './git.ts';
import { ciFixPrompt, skillFailed } from './tasks.ts';

/** @returns задача из трейлера `Этап: NN/Tn` коммита HEAD; служебный `NN/infra` — не задача. */
export async function headTask(context: LoopContext): Promise<string | undefined> {
  const trailer = await context.git.run(['log', '-1', '--format=%(trailers:key=Этап,valueonly)']);
  const task = trailer.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  return /^\d+\/T\S+$/.test(task) ? task : undefined;
}

/**
 * Красный `slow` на HEAD — исправление задачей из трейлера HEAD (обычно это коммит ревью
 * задачи, которая его сломала). Идущий или непроверенный прогон работу не держит.
 * @returns шаг цикла или undefined — можно работать дальше.
 */
export async function slowGate(context: LoopContext): Promise<Step | undefined> {
  const slow = await pollSlow(context);
  // Прогон перезапущен на GitHub (кнопкой на сайте или клавишей консоли): красного больше нет.
  if (slow.verdict !== 'red') await settleWait(context, (key) => key.startsWith('slow:'));
  if (slow.verdict === 'green') {
    if (context.state.slowFixes.length > 0 || context.state.slowBug !== undefined) {
      context.state.slowFixes = [];
      delete context.state.slowBug;
      await save(context);
    }
    return undefined;
  }
  if (slow.verdict !== 'red') return undefined;
  const task = await headTask(context);
  if (task !== undefined && !context.state.slowFixes.includes(task)) {
    context.state.slowFixes.push(task);
    await save(context);
    await context.say(`красный slow (все тесты): ${slow.line} — исправляет ${task}`);
    const prompt = ciFixPrompt(task, `slow ${slow.line}`);
    const result = await runSkill(context, 'next', prompt);
    return result.ok ? 'worked' : skillFailed(context, prompt, result);
  }
  return slowWithoutFixer(context, slow.line, task);
}

/**
 * Красный `slow`, который некому чинить задачей: служебный коммит или задача уже чинила.
 * Сначала один перезапуск прогона (падение раннера или процесса), затем баг Б1 через `$bug` —
 * его чинит `$next` первым в очереди. Владелец нужен, только если не помог и баг.
 * 2026-10-14: раньше цикл сразу ждал владельца со словами «перешли ссылку Claude».
 */
async function slowWithoutFixer(
  context: LoopContext,
  line: string,
  task: string | undefined,
): Promise<Step | undefined> {
  const current = await head(context.git);
  if (context.state.slowRerun !== current && (await rerunSlow(context, line))) {
    context.state.slowRerun = current;
    await save(context);
    return undefined;
  }
  // Баг уже записан: его задача стоит первой в очереди, `$next` чинит её как любую другую.
  if (context.state.slowBug === undefined) {
    const prompt = `$bug красный slow (все тесты) на ${task === undefined ? `служебном коммите ${current.slice(0, 7)}` : `коммите ${current.slice(0, 7)} после исправления ${task}`}, перезапуск прогона не помог: ${line}. Класс Б1: починить, чтобы slow стал зелёным.`;
    const result = await runSkill(context, 'next', prompt);
    if (!result.ok) return skillFailed(context, prompt, result);
    context.state.slowBug = current;
    await save(context);
    return 'worked';
  }
  if (task === undefined) return undefined;
  return park(
    context,
    `slow:${current}`,
    `slow всё ещё красный: не помогли перезапуск, исправление ${task} и записанный баг. Ответ — Issue «$decide» с решением; станет зелёным — цикл продолжит сам: ${line}`,
  );
}

/** Перезапуск упавших jobs прогона из строки `ci:wait`. @returns false — перезапустить нельзя. */
async function rerunSlow(context: LoopContext, line: string): Promise<boolean> {
  const run = /\/actions\/runs\/(\d+)/u.exec(line)?.[1];
  if (run === undefined || context.config.github === undefined) return false;
  try {
    await context.config.github.rerunFailedJobs(Number(run));
  } catch (error) {
    // Нет права или сеть: перезапуск — лишь попытка, дальше баг через `$bug`.
    await context.say(
      `slow не перезапущен: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  await context.say(`красный slow перезапущен один раз (прогон ${run}): ${line}`);
  return true;
}

/**
 * Перед `$stage-close`: этап закрывается только на зелёном `slow`. Красный ведёт к
 * исправлению через slowGate на следующем шаге, непроверенный — пауза.
 * @returns шаг цикла или undefined — `slow` зелёный.
 */
export async function slowBeforeClose(context: LoopContext): Promise<Step | undefined> {
  const slow = await waitSlow(context, 'перед $stage-close');
  if (slow.verdict === 'green') return undefined;
  if (slow.verdict === 'red') {
    const fixed = await slowGate(context);
    if (fixed !== undefined) return fixed;
    // Перезапущенный прогон дождётся следующий шаг. Записанный баг пропускает очередь к своей
    // задаче, но этап на красном не закрывается.
    const current = await head(context.git);
    if (context.state.slowRerun === current && context.state.slowBug === undefined) return 'worked';
    return park(
      context,
      `slow-close:${current}`,
      `slow (все тесты) красный перед $stage-close, баг записан, а очередь пуста: ${slow.line}. Ответ — Issue «$decide» с решением`,
    );
  }
  return park(
    context,
    `slow-close:${await head(context.git)}`,
    `slow (все тесты) перед $stage-close не проверен: ${slow.line}`,
  );
}
