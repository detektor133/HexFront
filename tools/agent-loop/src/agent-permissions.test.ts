import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const hook = '.codex/hooks/agent-permissions.mjs';

function runHook(
  role: string | undefined,
  command: string,
  toolName = 'apply_patch',
): { readonly status: number; readonly output: string } {
  try {
    const output = execFileSync('node', [hook], {
      cwd: process.cwd(),
      env:
        role === undefined
          ? { ...process.env, AGENT_ROLE: '' }
          : { ...process.env, AGENT_ROLE: role },
      input: JSON.stringify({ tool_name: toolName, tool_input: { command } }),
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (error) {
    const result = error as { status?: number; stdout?: string };
    return { status: result.status ?? 1, output: result.stdout ?? '' };
  }
}

describe('права агентной роли', () => {
  it('блокируют запись planner вне docs', () => {
    const result = runHook('planner', '*** Begin Patch\n*** Update File: packages/sim/src/step.ts');
    expect(JSON.parse(result.output).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('разрешают tester писать тест', () => {
    const result = runHook(
      'tester',
      '*** Begin Patch\n*** Add File: tools/agent-loop/src/example.test.ts',
    );
    expect(result.output).toBe('');
  });

  it('не блокируют ручной режим без AGENT_ROLE', () => {
    expect(
      runHook(undefined, '*** Begin Patch\n*** Update File: packages/sim/src/step.ts').output,
    ).toBe('');
  });
});
