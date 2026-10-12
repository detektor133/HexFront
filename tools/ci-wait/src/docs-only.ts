// Шаг CI: пуш, который меняет только служебные docs (отметки этапа, STATUS, отчёты), не гоняет
// `pnpm check` повторно, а наследует результат CI предыдущего пуша. Так зелёный CI на HEAD
// по-прежнему означает зелёный код, а docs-коммит ревью проверяется за секунды, а не за 5 минут.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { waitForCi } from './ci-wait.ts';

/** Файлы, которые не читает ни один тест, линтер или генератор (`docs/` вне prettier и eslint). */
const DOCS_ONLY_RE =
  /^docs\/(stages\/.+|reports\/.+|STATUS\.md|BUGS\.md|QUESTIONS\.md|DECISIONS\.md|CHANGELOG-proposals\.md)$/;
const ZERO_SHA_RE = /^0+$/;

export type CiMode = 'docs' | 'full';

/** @returns `docs`, если список изменённых файлов не пуст и целиком служебный. */
export function classifyFiles(files: readonly string[]): CiMode {
  return files.length > 0 && files.every((file) => DOCS_ONLY_RE.test(file)) ? 'docs' : 'full';
}

export interface ScopeInput {
  readonly event: string | undefined;
  readonly before: string | undefined;
  readonly sha: string;
  readonly diff: (before: string, sha: string) => readonly string[] | undefined;
}

/** @returns режим CI для пуша; всё, что нельзя доказать docs-пушем, — полный прогон. */
export function decideMode(input: ScopeInput): CiMode {
  if (input.event !== 'push' || !input.before || ZERO_SHA_RE.test(input.before)) return 'full';
  const files = input.diff(input.before, input.sha);
  return files === undefined ? 'full' : classifyFiles(files);
}

const gitDiff = (before: string, sha: string): readonly string[] | undefined => {
  try {
    return execFileSync('git', ['diff', '--name-only', before, sha], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    console.log(`git diff ${before} ${sha} не удался, полный прогон: ${String(error)}`);
    return undefined;
  }
};

async function main(): Promise<number> {
  const sha = process.env.GITHUB_SHA ?? '';
  const before = process.env.BEFORE_SHA;
  const mode = decideMode({ event: process.env.GITHUB_EVENT_NAME, before, sha, diff: gitDiff });
  console.log(`mode=${mode}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
  if (mode === 'full' || before === undefined) return 0;
  console.log(`только служебные docs: результат берётся из CI ${before}`);
  return waitForCi({
    repo: process.env.GITHUB_REPOSITORY ?? '',
    sha: before,
    ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
  });
}

if (process.argv[1]?.endsWith('docs-only.ts')) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.log(`failure docs-only error=${String(error)}`);
    process.exitCode = 1;
  }
}
