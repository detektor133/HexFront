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
    // cmd получает одну строку: так node и делал со списком аргументов, но список с shell
    // печатал предупреждение DEP0190 поверх панели консоли. Кавычки — prepareProcessArguments.
    const child =
      process.platform === 'win32'
        ? spawn([command, ...args].join(' '), { cwd: options.cwd, env: options.env, shell: true })
        : spawn(command, args, { cwd: options.cwd, env: options.env });
    if (options.input !== undefined) child.stdin.end(options.input);
    let stdout = '';
    let stderr = '';
    // Кириллица может разрезаться между кусками вывода: декодирование потоком, а не по куску.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
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
