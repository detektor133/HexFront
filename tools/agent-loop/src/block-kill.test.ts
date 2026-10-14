import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/** @returns код выхода хука: 2 — команда запрещена. */
function runHook(command: string): number {
  try {
    execFileSync('node', ['.codex/hooks/block-kill.mjs'], {
      cwd: process.cwd(),
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe('запрет остановки процессов агентом', () => {
  it.each([
    'Stop-Process -Id 23204 -Force',
    'Get-Process node | Stop-Process',
    'spps -Id 12',
    'taskkill /pid 4242 /T /F',
    'pkill -f vitest',
    'kill -9 4242',
    'kill 4242',
    '(Get-Process -Id 4242).Kill()',
  ])('блокирует «%s»', (command) => {
    expect(runHook(command)).toBe(2);
  });

  it.each([
    'pnpm verify --changed',
    'Get-Process node',
    'git commit -F .ai-logs/commit.txt',
    'rg -n "skill" docs | Select-Object -First 20',
  ])('пропускает «%s»', (command) => {
    expect(runHook(command)).toBe(0);
  });
});
