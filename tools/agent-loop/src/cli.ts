import { execFileSync } from 'node:child_process';

import { defaultRunCommand, runAgentLoop } from './agent-loop.ts';
import { httpGithubClient, parseGithubRepo } from './github.ts';
import { TASK_ID_SOURCE } from './stage-file.ts';
import { MAX_STREAMS } from './state.ts';

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

/** Пауза, которую прерывает Enter в консоли: владелец просит проверить сейчас. */
const sleepOrEnter = (ms: number): Promise<'timer' | 'wake'> =>
  new Promise((resolve) => {
    const finish = (result: 'timer' | 'wake') => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.pause();
      resolve(result);
    };
    const onData = () => finish('wake');
    const timer = setTimeout(() => finish('timer'), ms);
    if (process.stdin.isTTY) {
      process.stdin.once('data', onData);
      process.stdin.resume();
    }
  });

const resume = flag('--resume');
if (resume !== undefined && !new RegExp(`^${TASK_ID_SOURCE}$`).test(resume))
  throw new Error('--resume ждёт номер задачи, например 06/T1j7');
// Без флага — предел из памяти цикла (Issue `$streams N`); флаг его переписывает.
const streams = flag('--streams') === undefined ? undefined : positive('--streams', 1);
if (streams !== undefined && streams > MAX_STREAMS)
  throw new Error(`--streams должен быть от 1 до ${MAX_STREAMS}`);
const token = process.env.GITHUB_TOKEN;
const repo = parseGithubRepo(
  execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }),
);

process.exitCode = await runAgentLoop({
  root: process.cwd(),
  maxRounds: positive('--max-rounds', 3),
  maxMinutes: positive('--max-minutes', 120),
  pollSeconds: positive('--poll-seconds', 30),
  pollMinutes: positive('--poll-minutes', 10),
  once: process.argv.includes('--once'),
  dryRun: process.argv.includes('--dry-run'),
  ...(resume === undefined ? {} : { resume }),
  ...(streams === undefined ? {} : { streams }),
  runCommand: defaultRunCommand,
  now: Date.now,
  sleep: sleepOrEnter,
  writeLine: (line) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${line}`),
  ...(token ? { github: httpGithubClient(repo, token) } : {}),
});
