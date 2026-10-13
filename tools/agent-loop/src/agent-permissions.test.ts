import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function runHook(
  role: string | undefined,
  command: string,
  toolName = 'Bash',
  locked = '',
): string {
  return execFileSync('node', ['.codex/hooks/agent-permissions.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, AGENT_ROLE: role ?? '', AGENT_LOCKED: locked },
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

  it('пропускает stop-хук для spec: его приёмочные тесты нарочно красные', () => {
    expect(runStopHook('spec')).toBe(0);
  });

  it('spec пишет только тесты, не код', () => {
    expect(runHook('spec', 'echo x > packages/sim/test/new-rule.test.ts')).toBe('');
    expect(runHook('spec', 'echo x > tools/evolve/src/exam.test.ts')).toBe('');
    const output = runHook('spec', 'echo x > packages/sim/src/step.ts');
    expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('исполнитель не может менять приёмочные тесты из AGENT_LOCKED, остальное — может', () => {
    const locked = 'packages/sim/test/new-rule.test.ts\ntools/evolve/src/exam.test.ts';
    const patch = '*** Begin Patch\n*** Update File: tools/evolve/src/exam.test.ts';
    const output = runHook(undefined, patch, 'apply_patch', locked);
    expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(JSON.parse(output).hookSpecificOutput.permissionDecisionReason).toContain(
      'приёмочные тесты задачи менять нельзя',
    );
    expect(runHook(undefined, 'echo x > packages/sim/src/step.ts', 'Bash', locked)).toBe('');
  });
});
