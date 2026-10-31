import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESTART_FOR_CONTROL_CHANGE = 75;

/** Держит консоль владельца, пока обновлённый код цикла запускается новым процессом. */
export async function supervise(worker: string, args: readonly string[]): Promise<number> {
  for (;;) {
    const code = await new Promise<number>((resolveExit, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', worker, ...args], {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => resolveExit(exitCode ?? (signal ? 1 : 0)));
    });
    if (code !== RESTART_FOR_CONTROL_CHANGE) return code;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await supervise(
    fileURLToPath(new URL('./cli.ts', import.meta.url)),
    process.argv.slice(2),
  );
}
