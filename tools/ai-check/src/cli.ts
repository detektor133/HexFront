// Тихая обёртка над проверками для AI-агента: в вывод попадают только упавшие тесты, ошибки
// lint/типов и одна строка итога — зелёный прогон не тратит токены.
// Запуск: pnpm ai-check [--changed | --full | --staged]
//   --changed — типы, lint/prettier изменённых файлов, тесты, затронутые изменениями;
//   --full    — типы, lint, depcheck, tokens, все тесты с покрытием (как `pnpm check`);
//   --staged  — lint/prettier только staged-файлов (для pre-commit хука).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { summarizeVitest, trimStack, type VitestReport } from './summarize.ts';

type Mode = 'changed' | 'full' | 'staged';

const MAX_PER_STEP = 15;
const STACK_LINES = 10;
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const FORMAT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|yml|yaml)$/;
/** Файлы вне проверок линтера (как .prettierignore и eslint.config.js). */
const SKIP_RE = /^(docs\/|coverage\/|pnpm-lock\.yaml|apps\/client\/src\/theme\/tokens\.)/;

const MODES: Readonly<Record<string, Mode>> = {
  '--changed': 'changed',
  '--full': 'full',
  '--staged': 'staged',
};
const mode = MODES[process.argv[2] ?? '--changed'];
if (!mode) {
  console.error('usage: ai-check [--changed | --full | --staged]');
  process.exit(2);
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly out: string;
}

function run(cmd: string, args: readonly string[]): Run {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true, maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout, out: `${r.stdout}\n${r.stderr}` };
}

function git(args: readonly string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

function changedFiles(): string[] {
  if (mode === 'staged') return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  const tracked = git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
  return [...new Set([...tracked, ...git(['ls-files', '--others', '--exclude-standard'])])];
}

const problems: string[] = [];
const failedSteps: string[] = [];

function fail(step: string, lines: readonly string[]): void {
  failedSteps.push(step);
  problems.push(...lines.slice(0, MAX_PER_STEP));
  if (lines.length > MAX_PER_STEP) problems.push(`… ещё ${lines.length - MAX_PER_STEP} (${step})`);
}

interface EslintFile {
  readonly filePath: string;
  readonly messages: readonly {
    readonly line: number;
    readonly ruleId: string | null;
    readonly message: string;
  }[];
}

/** «файл:строка правило сообщение» по JSON-выводу ESLint; при сбое самого ESLint — хвост вывода. */
function eslintLines(r: Run): string[] {
  const start = r.stdout.indexOf('[');
  try {
    const files = JSON.parse(r.stdout.slice(start)) as EslintFile[];
    return files.flatMap((f) =>
      f.messages.map(
        (m) =>
          `${relative(process.cwd(), f.filePath).replaceAll('\\', '/')}:${m.line} ${m.ruleId ?? ''} ${m.message}`,
      ),
    );
  } catch {
    return trimStack(r.out, STACK_LINES).split('\n');
  }
}

/** `'all'` — весь репозиторий (`.`): список файлов не влезает в командную строку Windows. */
function lintFiles(files: readonly string[] | 'all'): void {
  const pick = (re: RegExp): string[] =>
    files === 'all' ? ['.'] : files.filter((f) => re.test(f) && !SKIP_RE.test(f));
  const code = pick(CODE_RE);
  const format = pick(FORMAT_RE);
  if (code.length > 0) {
    const r = run('pnpm', ['exec', 'eslint', '--max-warnings', '0', '--format', 'json', ...code]);
    if (r.code !== 0) fail('lint', eslintLines(r));
  }
  if (format.length > 0) {
    const r = run('pnpm', ['exec', 'prettier', '--check', ...format]);
    if (r.code !== 0) {
      fail(
        'prettier',
        r.out.split('\n').filter((l) => /^\[warn\] \S/.test(l) && !l.includes('Code style')),
      );
    }
  }
}

function simpleStep(name: string, args: readonly string[], keep: RegExp): void {
  const r = run('pnpm', ['-s', ...args]);
  if (r.code !== 0) {
    const lines = r.out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => keep.test(l));
    fail(name, lines.length > 0 ? lines : trimStack(r.out, STACK_LINES).split('\n'));
  }
}

function tests(): void {
  const dir = mkdtempSync(join(tmpdir(), 'ai-check-'));
  const outputFile = join(dir, 'vitest.json');
  const args = ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`];
  if (mode === 'changed') args.push('--changed', 'HEAD');
  else args.push('--coverage');
  const r = run('pnpm', args);
  let report: VitestReport | null;
  try {
    report = JSON.parse(readFileSync(outputFile, 'utf8')) as VitestReport;
  } catch {
    report = null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!report) {
    if (r.code !== 0) fail('tests', trimStack(r.out, STACK_LINES).split('\n'));
    return;
  }
  const failed = summarizeVitest(report, STACK_LINES);
  if (failed.length > 0) fail('tests', failed);
  else if (r.code !== 0) {
    const cov = r.out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /threshold/i.test(l));
    fail('tests', cov.length > 0 ? cov : trimStack(r.out, STACK_LINES).split('\n'));
  }
}

const started = Date.now();
if (mode === 'staged') {
  lintFiles(changedFiles());
} else if (mode === 'full') {
  simpleStep('types', ['typecheck'], /error TS\d+/);
  lintFiles('all');
  simpleStep('depcheck', ['depcheck'], /error|warn|→/i);
  simpleStep('tokens', ['tokens', '--check'], /\S/);
  tests();
} else {
  lintFiles(changedFiles());
  simpleStep('types', ['typecheck'], /error TS\d+/);
  tests();
}

const secs = Math.round((Date.now() - started) / 1000);
if (problems.length > 0) console.log(problems.join('\n'));
console.log(
  failedSteps.length === 0
    ? `ai-check ${mode}: OK (${secs} с)`
    : `ai-check ${mode}: FAIL — ${failedSteps.join(', ')} (${secs} с)`,
);
process.exit(failedSteps.length === 0 ? 0 : 1);
