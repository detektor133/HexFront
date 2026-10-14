// Workflow `slow` (все тесты с тяжёлыми): цикл его не ждёт, но красный чинится первым,
// а этап закрывается только на зелёном.
import {
  park,
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
  if (slow.verdict === 'green') {
    if (context.state.slowFixes.length > 0) {
      context.state.slowFixes = [];
      await save(context);
    }
    return undefined;
  }
  if (slow.verdict !== 'red') return undefined;
  const task = await headTask(context);
  const current = await head(context.git);
  if (task === undefined)
    return park(
      context,
      `slow:${current}`,
      `красный slow (все тесты) на служебном коммите, не задаче этапа. Открой ссылку: упал сам прогон (раннер, процесс) — нажми «Re-run failed jobs», упал тест — перешли ссылку Claude. Станет зелёным — цикл продолжит сам: ${slow.line}`,
    );
  if (context.state.slowFixes.includes(task))
    return park(
      context,
      `slow:${current}`,
      `slow снова красный после исправления ${task}. Открой ссылку: упал сам прогон — «Re-run failed jobs», упал тест — перешли ссылку Claude. Станет зелёным — цикл продолжит сам: ${slow.line}`,
    );
  context.state.slowFixes.push(task);
  await save(context);
  await context.say(`красный slow (все тесты): ${slow.line} — исправляет ${task}`);
  const prompt = ciFixPrompt(task, `slow ${slow.line}`);
  const result = await runSkill(context, 'next', prompt);
  return result.ok ? 'worked' : skillFailed(context, prompt, result);
}

/**
 * Перед `$stage-close`: этап закрывается только на зелёном `slow`. Красный ведёт к
 * исправлению через slowGate на следующем шаге, непроверенный — пауза.
 * @returns шаг цикла или undefined — `slow` зелёный.
 */
export async function slowBeforeClose(context: LoopContext): Promise<Step | undefined> {
  const slow = await waitSlow(context, 'перед $stage-close');
  if (slow.verdict === 'green') return undefined;
  if (slow.verdict === 'red') return slowGate(context);
  return park(
    context,
    `slow-close:${await head(context.git)}`,
    `slow (все тесты) перед $stage-close не проверен: ${slow.line}`,
  );
}
