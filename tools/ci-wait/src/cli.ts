import { execFileSync } from 'node:child_process';

import { parseGithubRepo, waitForCi } from './ci-wait.ts';

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim();

async function main(): Promise<number> {
  const sha = git(['rev-parse', 'HEAD']);
  const repo =
    process.env.GITHUB_REPOSITORY ?? parseGithubRepo(git(['remote', 'get-url', 'origin']));
  return waitForCi({
    repo,
    sha,
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
