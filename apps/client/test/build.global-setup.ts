// Клиент собирается один раз до тестов проекта: тесты только читают dist. 2026-10-15, 07/T14:
// `vite build` в файле теста очищал dist, пока параллельный файл его читал, и CI краснел через раз.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function setup(): void {
  execFileSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', '@hexfront/client', 'build'],
    {
      cwd: PROJECT_ROOT,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    },
  );
}
