// Запуск внешних команд (codex, git, pnpm) с stdin и таймаутом; на Windows — через cmd с кавычками.
import { spawn, type ChildProcess } from 'node:child_process';

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
export type RunCommand = (
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly input?: string;
    readonly timeoutMs?: number;
  },
) => Promise<CommandResult>;
export const quoteWindowsArgument = (argument: string): string =>
  `"${argument.replaceAll('"', '\\"')}"`;

export const prepareProcessArguments = (args: readonly string[]): readonly string[] =>
  process.platform === 'win32' ? args.map(quoteWindowsArgument) : args;

/**
 * На Windows команда идёт через cmd, и `kill` остановил бы только cmd, а codex продолжил бы
 * писать в дерево параллельно со следующей сессией. Поэтому дерево процессов — через taskkill.
 */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined)
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill();
}

const runProcess: RunCommand = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => killTree(child), options.timeoutMs);
    child.on('close', (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

export const defaultRunCommand = runProcess;
