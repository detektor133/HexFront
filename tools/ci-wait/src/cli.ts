import { execFileSync } from 'node:child_process';

import { parseGithubRepo, waitForCi } from './ci-wait.ts';

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim();

/**
 * `--workflow=slow.yml` — workflow всех тестов; `--sha=<sha>` — другой коммит, не HEAD;
 * `--once` — один опрос без ожидания; `--timeout-minutes=N` — предел ожидания;
 * `--all-workflows` — зелёный, только если зелёные и остальные workflow SHA, кроме `slow.yml`.
 */
const option = (name: string): string | undefined =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main(): Promise<number> {
  const sha = option('sha') ?? git(['rev-parse', 'HEAD']);
  const workflow = option('workflow');
  const timeout = Number(option('timeout-minutes'));
  const repo =
    process.env.GITHUB_REPOSITORY ?? parseGithubRepo(git(['remote', 'get-url', 'origin']));
  return waitForCi({
    repo,
    sha,
    ...(workflow === undefined ? {} : { workflow }),
    ...(timeout > 0 ? { timeoutMs: timeout * 60_000 } : {}),
    ...(process.argv.includes('--once') ? { once: true } : {}),
    ...(option('after-attempt') === undefined
      ? {}
      : { afterAttempt: Number(option('after-attempt')) }),
    ...(process.argv.includes('--all-workflows') ? { otherWorkflows: true } : {}),
    ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
  });
}

try {
  process.exitCode = await main();
} catch (error) {
  // Не результат CI, а сбой запроса (401, сеть): цикл не должен считать его красным CI.
  console.log(`error ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
