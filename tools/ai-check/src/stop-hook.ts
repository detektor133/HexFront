// Stop-хук Claude Code: пока в рабочем дереве есть изменения, агент не может закончить ход,
// если `pnpm verify --changed` красный (exit 2, итог — в stderr). Зелёный прогон или отсутствие
// изменений — exit 0. stop_hook_active = true значит, что агент уже продолжает после этого хука:
// выходим сразу, чтобы не зациклиться.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function stopHookActive(): boolean {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8')) as { stop_hook_active?: boolean };
    return input.stop_hook_active === true;
  } catch {
    // Пустой или битый stdin — обычный запуск вручную.
    return false;
  }
}

if (stopHookActive()) process.exit(0);

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty === '') process.exit(0);

const r = spawnSync('pnpm', ['verify', '--changed'], { encoding: 'utf8', shell: true });
if (r.status === 0) process.exit(0);
process.stderr.write(`${r.stdout}${r.stderr}\n`);
process.exit(2);
