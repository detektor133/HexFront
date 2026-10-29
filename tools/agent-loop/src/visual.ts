// Один визуальный гейт перед push: не повтор геометрических тестов (они уже зелёные), а взгляд на
// то, чего рект-ассерты не видят — искажённые/сжатые иконки и текст, нахлёст на глаз. Запускается
// один раз на весь цикл задачи, только если задача тронула клиентский UI, и только автоматическим
// Playwright-снимком — не ручной браузер (`docs/testing.md`, `AGENTS.md` §«Правила работы»).
// 2026-10-22: первая версия передавала пути снимков текстом в промпте — `$review` не может
// открыть файл как изображение через обычный инструмент чтения и честно отвечал, что не может
// выполнить проверку. Снимки должны идти через `codex exec -i <file>` (приложение изображения
// к сессии), а не как путь в тексте — тогда модель действительно видит картинку.
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { park, readStage, save, session, type LoopContext, type Step } from './context.ts';
import { batchReviewFindings } from './finding-repair.ts';
import { dirtyFiles, head, remoteHead } from './git.ts';
import { parseReviewVerdict, type Verdict } from './review.ts';
import { taskBlock } from './stage-file.ts';

const UI_GLOBS = [
  /^apps\/client\/src\/dev\//u,
  /^apps\/client\/src\/match\//u,
  /^apps\/client\/src\/render\//u,
  /^apps\/client\/src\/theme\//u,
] as const;

const WIDTHS = [360, 1024, 1920] as const;
const LAYOUT_SPEC = /^apps\/client\/tests\/e2e\/.*\.spec\.ts$/u;

async function taskImages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

async function missingVisualTest(
  context: LoopContext,
  task: string,
  reason: string,
): Promise<Step> {
  const active = context.state.activeTask;
  if (active !== undefined) {
    active.findings = [{ kind: 'ТЕСТ', text: `ТЕСТ: ${reason}` }];
    active.phase = 'work';
    await save(context);
  }
  await context.say(`визуальный гейт ${task}: ${reason}`);
  return 'worked';
}

interface VisualScope {
  readonly changedUi: string[];
  readonly layoutSpecs: string[];
  readonly criterion: string;
}

async function visualScope(context: LoopContext, task: string, base: string): Promise<VisualScope> {
  const [stage, changed] = await Promise.all([
    readStage(context.config.root),
    context.git.run(['diff', '--name-only', `${base}..HEAD`]),
  ]);
  const paths = changed
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
  const tagged = await Promise.all(
    paths
      .filter((path) => LAYOUT_SPEC.test(path))
      .map(async (path) =>
        (await readFile(join(context.config.root, path), 'utf8').catch(() => '')).includes(
          '@layout',
        )
          ? path
          : null,
      ),
  );
  return {
    changedUi: paths.filter((path) => UI_GLOBS.some((glob) => glob.test(path))),
    layoutSpecs: tagged.filter((path): path is string => path !== null),
    criterion: taskBlock(stage.stageText, task),
  };
}

interface VisualShots {
  readonly paths: string[];
  readonly layoutCount: number;
}

async function captureVisualShots(
  context: LoopContext,
  task: string,
  layoutSpecs: readonly string[],
): Promise<VisualShots | Step> {
  const outDir = join(
    context.config.root,
    '.ai-logs',
    'agent-loop',
    'visual',
    task.replaceAll('/', '-'),
    `${(await head(context.git)).slice(0, 12)}-${Date.now()}`,
  );
  const hudDir = join(outDir, 'hud');
  await mkdir(hudDir, { recursive: true });
  const shots = await context.config.runCommand('pnpm', ['test:e2e:visual'], {
    cwd: context.config.root,
    timeoutMs: 5 * 60_000,
    env: { ...process.env, VISUAL_OUT_DIR: hudDir },
  });
  if (shots.code !== 0)
    return park(
      context,
      `visual:${task}`,
      `${task}: не удалось снять визуальные снимки HUD — проверь вручную`,
      `${shots.stdout}\n${shots.stderr}`.slice(-2_000),
    );
  let layoutPaths: string[] = [];
  if (layoutSpecs.length > 0) {
    const layoutDir = join(outDir, 'task');
    await mkdir(layoutDir, { recursive: true });
    const layout = await context.config.runCommand('pnpm', ['test:e2e:layout', ...layoutSpecs], {
      cwd: context.config.root,
      timeoutMs: 5 * 60_000,
      env: { ...process.env, VISUAL_OUT_DIR: layoutDir },
    });
    if (layout.code !== 0)
      return missingVisualTest(
        context,
        task,
        `сценарий снимка не прошёл: ${layout.stderr || layout.stdout}`.slice(-800),
      );
    layoutPaths = await taskImages(layoutDir);
    if (layoutPaths.length === 0)
      return missingVisualTest(
        context,
        task,
        'сценарий @layout не создал снимок изменённого элемента',
      );
  }
  return {
    paths: [...layoutPaths, ...WIDTHS.map((width) => join(hudDir, `hud-${width}.png`))],
    layoutCount: layoutPaths.length,
  };
}

function visualPrompt(task: string, scope: VisualScope, shots: VisualShots): string {
  const hasTaskShots = shots.layoutCount > 0;
  return [
    `$review ${task}`,
    `Приложены ${shots.paths.length} снимков: сначала ${shots.layoutCount} из @layout-сценария задачи, затем HUD на ${WIDTHS.join(', ')} px.`,
    `Критерий этой задачи:\n${scope.criterion}`,
    `Изменённые файлы UI этой задачи:\n${scope.changedUi.join('\n')}`,
    `Сценарии состояния изменённого элемента:\n${scope.layoutSpecs.join('\n')}`,
    'Проверяй только изменённый UI-элемент из критерия задачи, видимый на снимках: искажение, нахлёст, обрезку.',
    hasTaskShots
      ? 'Если изменённый элемент отсутствует и на снимках сценария, верни ТЕСТ с путём сценария.'
      : 'Снимков состояния изменённого элемента нет: видны только общие кадры HUD. Не требуй отсутствующий @layout-сценарий, если его нет в критерии задачи; не делай выводов о невидимом элементе.',
    'В каждом замечании укажи точный путь изменённого UI-файла или @layout-сценария из списка выше и ширину снимка. Замечания к другим элементам карты не возвращай.',
    'Код не читай, ничего не меняй и не коммить. Ответ — JSON по схеме review.',
  ].join('\n');
}

async function applyVisualFindings(
  context: LoopContext,
  task: string,
  scope: VisualScope,
  verdict: Extract<Verdict, { readonly ok: false }>,
): Promise<Step | undefined> {
  const relevant = verdict.findings.filter(
    (finding) =>
      (scope.layoutSpecs.length > 0 ||
        scope.criterion.includes('@layout') ||
        finding.kind !== 'ТЕСТ') &&
      [...scope.changedUi, ...scope.layoutSpecs].some((path) => finding.text.includes(path)),
  );
  if (relevant.length !== verdict.findings.length)
    await context.say(
      `визуальный гейт ${task}: ${verdict.findings.length - relevant.length} пункт(ов) вне изменённого UI пропущено`,
    );
  if (relevant.length === 0) return undefined;
  const active = context.state.activeTask;
  if (active !== undefined) {
    active.findings = [...batchReviewFindings(relevant)];
    active.findingRetries = 0;
    active.phase = 'work';
    await save(context);
  }
  await context.say(
    `визуальный гейт ${task}: ${relevant.length} пунктов собраны в ${active?.findings.length ?? 0} пакет(а) по ролям`,
  );
  return 'worked';
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
  const scope = await visualScope(context, task, base);
  if (scope.changedUi.length === 0) return undefined;
  if (scope.criterion.includes('@layout') && scope.layoutSpecs.length === 0)
    return missingVisualTest(
      context,
      task,
      'в задаче требуется @layout, но её сценарий не добавлен',
    );
  const shots = await captureVisualShots(context, task, scope.layoutSpecs);
  if (typeof shots === 'string') return shots;
  const beforeHead = await head(context.git);
  const beforeRemote = await remoteHead(context.git);
  const beforeTree = await dirtyFiles(context.git);
  const result = await session(
    context,
    'review',
    visualPrompt(task, scope, shots),
    [],
    shots.paths,
  );
  if (result.failure !== undefined)
    return park(
      context,
      `visual:${task}`,
      `${task}: визуальный review не выполнен — ${result.failure}`,
      result.message,
    );
  if (
    (await head(context.git)) !== beforeHead ||
    (await remoteHead(context.git)) !== beforeRemote ||
    (await dirtyFiles(context.git)) !== beforeTree
  )
    return park(context, `visual:${task}`, `${task}: визуальный reviewer изменил Git или файлы`);
  const verdict = parseReviewVerdict(result.message);
  if (verdict === undefined)
    return park(
      context,
      `visual:${task}`,
      `${task}: визуальный review нарушил протокол ответа`,
      result.message,
    );
  if (verdict.ok) return undefined;
  return applyVisualFindings(context, task, scope, verdict);
}
