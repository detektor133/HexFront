import { defaultRunCommand, runAgentLoop } from './agent-loop.ts';

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

process.exitCode = await runAgentLoop({
  root: process.cwd(),
  maxTasks: positive('--max-tasks', 1),
  maxRounds: positive('--max-rounds', 3),
  maxMinutes: positive('--max-minutes', 120),
  dryRun: process.argv.includes('--dry-run'),
  runCommand: defaultRunCommand,
  now: Date.now,
  writeLine: (line) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}] ${line}`),
});
