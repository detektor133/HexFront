import { execFileSync } from 'node:child_process';

import { parseGithubRepo, waitForCi } from './ci-wait.ts';

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** `--workflow=slow.yml` — ждать workflow всех тестов; `--sha=<sha>` — другой коммит, не HEAD. */
const option = (name: string): string | undefined =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main(): Promise<number> {
  const sha = option('sha') ?? git(['rev-parse', 'HEAD']);
  const workflow = option('workflow');
  const repo =
    process.env.GITHUB_REPOSITORY ?? parseGithubRepo(git(['remote', 'get-url', 'origin']));
  return waitForCi({
    repo,
    sha,
    ...(workflow === undefined ? {} : { workflow }),
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
