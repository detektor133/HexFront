import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function runHook(command: string): number {
  try {
    execFileSync('node', ['.codex/hooks/block-browser.mjs'], {
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

describe('запрет ручного браузера', () => {
  it.each(['pnpm dev', 'npx playwright test', 'playwright open', 'vite --host 127.0.0.1'])(
    'блокирует «%s»',
    (command) => {
      expect(runHook(command)).toBe(2);
    },
  );

  it.each(['pnpm test:e2e', 'pnpm test:e2e:layout hud-layout.spec.ts', 'pnpm probe:memory'])(
    'пропускает проектную команду «%s»',
    (command) => {
      expect(runHook(command)).toBe(0);
    },
  );
});
