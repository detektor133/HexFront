import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function runHook(role: string | undefined, command: string, toolName = 'Bash'): string {
  return execFileSync('node', ['.codex/hooks/agent-permissions.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, AGENT_ROLE: role ?? '' },
    input: JSON.stringify({ tool_name: toolName, tool_input: { command } }),
    encoding: 'utf8',
  });
}

function runStopHook(role: string): number {
  try {
    execFileSync('node', ['.codex/hooks/stop-verify.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, AGENT_ROLE: role },
      input: '{}',
      encoding: 'utf8',
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe('права агентной роли', () => {
  it('читает конфиг и блокирует apply_patch planner вне docs', () => {
    const output = runHook(
      'planner',
      '*** Begin Patch\n*** Update File: packages/sim/src/step.ts',
      'apply_patch',
    );
    expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('разрешает tester писать тест и общий .ai-logs', () => {
    expect(runHook('tester', 'echo x > test/example.test.ts')).toBe('');
    expect(runHook('tester', 'Set-Content -Path .ai-logs/commit.txt -Value x')).toBe('');
  });

  it('запрещает coder перенаправлять вывод в test', () => {
    const output = runHook('coder', 'echo x > test/example.txt');
    expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('разрешает coder обычную команду тестов с 2>&1', () => {
    expect(runHook('coder', 'pnpm vitest packages/sim/test/x.test.ts 2>&1')).toBe('');
  });

  it('не считает &1, $null и NUL целями записи', () => {
    expect(runHook('coder', 'pnpm test 2>&1')).toBe('');
    expect(runHook('coder', 'Write-Output x > $null')).toBe('');
    expect(runHook('coder', 'Write-Output x > NUL')).toBe('');
  });

  it('не блокирует ручной режим без AGENT_ROLE', () => {
    expect(runHook(undefined, 'echo x > packages/sim/src/step.ts')).toBe('');
  });

  it.each(['planner', 'tester', 'reviewer'])('пропускает stop-хук для %s', (role) => {
    expect(runStopHook(role)).toBe(0);
  });
});
