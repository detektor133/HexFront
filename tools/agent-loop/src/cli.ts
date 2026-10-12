import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

import { defaultRunCommand, runAgentLoop } from './agent-loop.ts';
import { httpGithubClient, parseGithubRepo } from './github.ts';
import { TASK_ID_SOURCE } from './stage-file.ts';

/** Значение флага в форме `--name N` или `--name=N`. */
const flag = (name: string): string | undefined => {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

const positive = (name: string, fallback: number): number => {
  const value = Number(flag(name) ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} должен быть целым ≥ 1`);
  return value;
};

const resume = flag('--resume');
if (resume !== undefined && !new RegExp(`^${TASK_ID_SOURCE}$`).test(resume))
  throw new Error('--resume ждёт номер задачи, например 06/T1j7');
const token = process.env.GITHUB_TOKEN;
const repo = parseGithubRepo(
  execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }),
);

process.exitCode = await runAgentLoop({
  root: process.cwd(),
  maxRounds: positive('--max-rounds', 3),
  maxMinutes: positive('--max-minutes', 120),
  pollMinutes: positive('--poll-minutes', 5),
  once: process.argv.includes('--once'),
  dryRun: process.argv.includes('--dry-run'),
  ...(resume === undefined ? {} : { resume }),
  runCommand: defaultRunCommand,
  now: Date.now,
  sleep: (ms) => sleep(ms),
  writeLine: (line) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${line}`),
  ...(token ? { github: httpGithubClient(repo, token) } : {}),
});
