import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import type { LoopContext } from './context.ts';
import { head, makeGit } from './git.ts';
import { defaultRunCommand } from './process.ts';
import { ciRecheckSafe } from './tasks.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })),
  );
});

it('различает служебный коммит и продуктовую правку после красного CI на настоящем Git', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hexfront-ci-recheck-'));
  roots.push(root);
  const git = makeGit(defaultRunCommand, root);
  await git.run(['init']);
  await git.run(['config', 'user.email', 'loop@test']);
  await git.run(['config', 'user.name', 'loop']);
  await git.run(['config', 'core.hooksPath', 'no-hooks']);
  await git.run(['commit', '--allow-empty', '-m', 'base']);
  const base = await head(git);
  const context = { git } as LoopContext;

  await git.run(['commit', '--allow-empty', '-m', 'инфраструктура', '-m', 'Этап: 07/infra']);
  expect(await ciRecheckSafe(context, base)).toBe(true);

  await git.run(['commit', '--allow-empty', '-m', 'продукт', '-m', 'Этап: 07/T17bc']);
  expect(await ciRecheckSafe(context, base)).toBe(false);
});
