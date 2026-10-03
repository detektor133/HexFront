// Единая проверка для AI-агента: build → типы → lint → тесты → visual.
// Полный вывод шагов — в .ai-logs/verify-<время>.log, в консоль — итог до 20 строк и путь к логу.
// Запуск: pnpm verify [--changed]
//   (без флага)  — весь репозиторий, все тесты, visual;
//   --changed    — lint только изменённых файлов, тесты, затронутые изменениями, visual — если
//                  менялся код клиента или пакетов (иначе кадры не могли измениться).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STEP_TIMEOUT_MS = 10 * 60 * 1000;
const SUMMARY_MAX_LINES = 20;
const ERRORS_PER_STEP = 4;
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const FORMAT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|yml|yaml)$/;
/** Файлы вне линтера (как .prettierignore и eslint.config.js). */
const SKIP_RE =
  /^(docs\/|coverage\/|\.ai-logs\/|pnpm-lock\.yaml|apps\/client\/src\/theme\/tokens\.)/;
const VISUAL_RE = /^(apps\/client|packages)\//;
/** Что считать строкой ошибки в выводе шага. */
const ERROR_RE = /error|FAIL|✗|×|AssertionError|не прошло|expected|warn/i;

const changedOnly = process.argv.includes('--changed');

interface Step {
  readonly name: string;
  readonly cmd: string;
  readonly args: readonly string[];
}

function git(args: readonly string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n')
    .map((l) => l.trim().replaceAll('"', ''))
    .filter((l) => l !== '');
}

function changedFiles(): string[] {
  const tracked = git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
  return [...new Set([...tracked, ...git(['ls-files', '--others', '--exclude-standard'])])];
}

function buildSteps(): Step[] {
  const files = changedOnly ? changedFiles() : null;
  const pick = (re: RegExp): string[] =>
    files === null ? ['.'] : files.filter((f) => re.test(f) && !SKIP_RE.test(f));
  const code = pick(CODE_RE);
  const format = pick(FORMAT_RE);
  const steps: Step[] = [
    { name: 'build', cmd: 'pnpm', args: ['-r', '--if-present', 'build'] },
    { name: 'types', cmd: 'pnpm', args: ['typecheck'] },
  ];
  if (code.length > 0) {
    steps.push({
      name: 'lint',
      cmd: 'pnpm',
      args: ['exec', 'eslint', '--max-warnings', '0', ...code],
    });
  }
  if (format.length > 0) {
    steps.push({ name: 'prettier', cmd: 'pnpm', args: ['exec', 'prettier', '--check', ...format] });
  }
  steps.push({
    name: 'tests',
    cmd: 'pnpm',
    args: ['exec', 'vitest', 'run', ...(changedOnly ? ['--changed', 'HEAD'] : ['--coverage'])],
  });
  if (files === null || files.some((f) => VISUAL_RE.test(f))) {
    steps.push({ name: 'visual', cmd: 'pnpm', args: ['-s', 'visual'] });
  }
  return steps;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
mkdirSync('.ai-logs', { recursive: true });
const logPath = join('.ai-logs', `verify-${stamp}.log`).replaceAll('\\', '/');
writeFileSync(logPath, '');

const started = Date.now();
const summary: string[] = [];
let failed = 0;
for (const step of buildSteps()) {
  const t = Date.now();
  const r = spawnSync(step.cmd, step.args, {
    encoding: 'utf8',
    shell: true,
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const secs = Math.round((Date.now() - t) / 1000);
  appendFileSync(
    logPath,
    `\n===== ${step.name}: ${step.cmd} ${step.args.join(' ')} =====\n${out}\n`,
  );
  const ok = r.status === 0 && r.error === undefined;
  if (ok) {
    summary.push(`ok   ${step.name} (${secs} с)`);
    continue;
  }
  failed += 1;
  const timedOut = r.error !== undefined ? ' — таймаут или сбой запуска' : '';
  summary.push(`FAIL ${step.name} (${secs} с)${timedOut}`);
  const lines = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => ERROR_RE.test(l));
  if (lines.length === 0) {
    lines.push(
      ...out
        .split('\n')
        .filter((l) => l.trim() !== '')
        .slice(-ERRORS_PER_STEP),
    );
  }
  for (const l of lines.slice(0, ERRORS_PER_STEP)) summary.push(`     ${l.slice(0, 200)}`);
  if (lines.length > ERRORS_PER_STEP) summary.push(`     … ещё ${lines.length - ERRORS_PER_STEP}`);
  // Дальше при красном шаге идти бессмысленно: тесты на несобранном коде — шум.
  if (step.name === 'build' || step.name === 'types') break;
}
const total = Math.round((Date.now() - started) / 1000);
const head = failed === 0 ? 'verify: OK' : `verify: FAIL (${failed})`;
const tail = [`${head} (${total} с)`, `лог: ${logPath} (искать: grep -n -C3 "FAIL\\|error")`];
const room = SUMMARY_MAX_LINES - tail.length;
const shown = summary.length > room ? [...summary.slice(0, room - 1), '…'] : summary;
console.log([...shown, ...tail].join('\n'));
process.exit(failed === 0 ? 0 : 1);
