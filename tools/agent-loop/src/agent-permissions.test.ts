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
  it('блокирует apply_patch reviewer в коде', () => {
    const output = runHook(
      'reviewer',
      '*** Begin Patch\n*** Update File: packages/sim/src/step.ts',
      'apply_patch',
    );
    expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('разрешает reviewer писать файл этапа, STATUS и .ai-logs', () => {
    expect(runHook('reviewer', 'echo x > docs/stages/stage-06-bots-balance.md')).toBe('');
    expect(runHook('reviewer', 'echo x > docs/STATUS.md')).toBe('');
    expect(runHook('reviewer', 'Set-Content -Path .ai-logs/commit.txt -Value x')).toBe('');
  });

  it('запрещает reviewer перенаправлять вывод в тесты', () => {
    const output = runHook('reviewer', 'echo x > test/example.txt');
    expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('не считает 2>&1, $null и NUL целями записи', () => {
    expect(runHook('reviewer', 'pnpm test 2>&1')).toBe('');
    expect(runHook('reviewer', 'Write-Output x > $null')).toBe('');
    expect(runHook('reviewer', 'Write-Output x > NUL')).toBe('');
  });

  it('не блокирует $next и ручной режим без AGENT_ROLE', () => {
    expect(runHook(undefined, 'echo x > packages/sim/src/step.ts')).toBe('');
  });

  it('пропускает stop-хук для reviewer', () => {
    expect(runStopHook('reviewer')).toBe(0);
  });
});
