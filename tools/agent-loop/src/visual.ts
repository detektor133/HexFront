// Один визуальный гейт перед push: не повтор геометрических тестов (они уже зелёные), а взгляд на
// то, чего рект-ассерты не видят — искажённые/сжатые иконки и текст, нахлёст на глаз. Запускается
// один раз на весь цикл задачи, только если задача тронула клиентский UI, и только автоматическим
// Playwright-снимком — не ручной браузер (`docs/testing.md`, `AGENTS.md` §«Правила работы»).
// 2026-10-22: первая версия передавала пути снимков текстом в промпте — `$review` не может
// открыть файл как изображение через обычный инструмент чтения и честно отвечал, что не может
// выполнить проверку. Снимки должны идти через `codex exec -i <file>` (приложение изображения
// к сессии), а не как путь в тексте — тогда модель действительно видит картинку.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { park, save, session, type LoopContext, type Step } from './context.ts';
import { batchReviewFindings } from './finding-repair.ts';
import { parseReviewVerdict } from './review.ts';

const UI_GLOBS = [
  /^apps\/client\/src\/dev\//u,
  /^apps\/client\/src\/match\//u,
  /^apps\/client\/src\/render\//u,
  /^apps\/client\/src\/theme\//u,
] as const;

const WIDTHS = [360, 1024, 1920] as const;

/** @returns true, если коммиты задачи с `base` по HEAD тронули клиентский UI-код. */
export async function touchesUi(context: LoopContext, base: string): Promise<boolean> {
  const names = (await context.git.run(['diff', '--name-only', `${base}..HEAD`]))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return names.some((name) => UI_GLOBS.some((glob) => glob.test(name)));
}

/**
 * Снимает HUD на трёх ширинах и зовёт review посмотреть на них живьём (снимки приложены как
 * изображения, не упомянуты путём в тексте). Пропускает задачи, которые не трогали UI.
 * @returns `undefined` — гейт пройден или не нужен; иначе шаг цикла.
 */
export async function runVisualGate(
  context: LoopContext,
  task: string,
  base: string,
): Promise<Step | undefined> {
  if (!(await touchesUi(context, base))) return undefined;
  const outDir = join(
    context.config.root,
    '.ai-logs',
    'agent-loop',
    'visual',
    task.replaceAll('/', '-'),
  );
  await mkdir(outDir, { recursive: true });
  const shots = await context.config.runCommand('pnpm', ['test:e2e:visual'], {
    cwd: context.config.root,
    timeoutMs: 5 * 60_000,
    env: { ...process.env, VISUAL_OUT_DIR: outDir },
  });
  if (shots.code !== 0)
    return park(
      context,
      `visual:${task}`,
      `${task}: не удалось снять визуальные снимки HUD — проверь вручную`,
      `${shots.stdout}\n${shots.stderr}`.slice(-2_000),
    );
  const paths = WIDTHS.map((width) => join(outDir, `hud-${width}.png`));
  const prompt = [
    `$review ${task}`,
    `Визуальная проверка (не повтор геометрических тестов — они уже зелёные). Приложены ${paths.length} снимка HUD по порядку: ${WIDTHS.join(', ')} px.`,
    'Ищи то, что рект-проверки не видят: искажённые или сжатые трансформацией иконки и текст,',
    'нахлёст элементов на глаз, нечитаемые подписи, обрезанные буквы. Код не читай, ничего не меняй и не коммить.',
    'Ответ: первая строка `OK` или `ВОЗВРАТ`. При возврате — пункты `- КОД: ...` с описанием искажения и шириной, на которой оно видно.',
  ].join('\n');
  const result = await session(context, 'review', prompt, [], paths);
  if (result.failure !== undefined)
    return park(
      context,
      `visual:${task}`,
      `${task}: визуальный review не выполнен — ${result.failure}`,
      result.message,
    );
  const verdict = parseReviewVerdict(result.message);
  if (verdict === undefined)
    return park(
      context,
      `visual:${task}`,
      `${task}: визуальный review нарушил протокол ответа`,
      result.message,
    );
  if (verdict.ok) return undefined;
  const active = context.state.activeTask;
  if (active !== undefined) {
    active.findings = [...batchReviewFindings(verdict.findings)];
    active.findingRetries = 0;
    active.phase = 'work';
    await save(context);
  }
  await context.say(
    `визуальный гейт ${task}: ${verdict.findings.length} пунктов собраны в ${active?.findings.length ?? 0} пакет(а) по ролям`,
  );
  return 'worked';
}
