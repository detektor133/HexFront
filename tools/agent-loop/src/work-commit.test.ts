import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeGit } from './git.ts';
import { defaultRunCommand } from './process.ts';
import { loadState } from './state.ts';
import { commitVerifiedWork } from './tasks.ts';

const git = (root: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'hexfront-work-commit-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Agent Test');
    git(root, 'config', 'user.email', 'agent-test@example.invalid');
    git(root, 'config', 'core.autocrlf', 'false');
    await writeFile(join(root, 'README.md'), 'base\n', 'utf8');
    git(root, 'add', '--', 'README.md');
    git(root, 'commit', '-qm', 'base');
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('локальный коммит проверенной работы', () => {
  it('коммитит только стабильные пути задачи настоящим Git', async () => {
    await withRepository(async (root) => {
      const path = 'packages/sim/src/task.ts';
      await mkdir(join(root, 'packages/sim/src'), { recursive: true });
      await writeFile(join(root, path), 'export const task = true;\n', 'utf8');
      const state = await loadState(root);
      state.activeTask = {
        task: '07/T17baa',
        base: git(root, 'rev-parse', 'HEAD'),
        workPrompt: '$task 07/T17baa',
        phase: 'work',
        findings: [],
        workDirtyAttempts: 3,
        workDirtyPaths: [path],
        verifiedDirtyPaths: [path],
      };
      const result = await commitVerifiedWork(
        { git: makeGit(defaultRunCommand, root), state, say: async () => undefined },
        '07/T17baa',
        [path],
      );
      expect(result).toEqual({ kind: 'committed' });
      expect(git(root, 'diff', '--name-only', 'HEAD^..HEAD')).toBe(path);
      expect(git(root, 'status', '--porcelain')).toBe('');
    });
  });

  it('не включает заранее staged чужой файл', async () => {
    await withRepository(async (root) => {
      const path = 'packages/sim/src/task.ts';
      await mkdir(join(root, 'packages/sim/src'), { recursive: true });
      await writeFile(join(root, path), 'export const task = true;\n', 'utf8');
      await writeFile(join(root, 'foreign.txt'), 'foreign\n', 'utf8');
      git(root, 'add', '--', 'foreign.txt');
      const before = git(root, 'rev-parse', 'HEAD');
      const state = await loadState(root);
      state.activeTask = {
        task: '07/T17baa',
        base: before,
        workPrompt: '$task 07/T17baa',
        phase: 'work',
        findings: [],
        workDirtyAttempts: 3,
        workDirtyPaths: [path],
        verifiedDirtyPaths: [path],
      };
      const result = await commitVerifiedWork(
        { git: makeGit(defaultRunCommand, root), state, say: async () => undefined },
        '07/T17baa',
        [path],
      );
      expect(result).toEqual({ kind: 'failed', reason: 'git commit: в индексе есть чужие файлы' });
      expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
    });
  });
});
