import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { head, makeGit, mergedIntoMain, syncWithOrigin, type Git } from './git.ts';
import { defaultRunCommand } from './process.ts';

const roots: string[] = [];

/** Настоящий git: origin — голый репозиторий, два клона — ПК владельца и «чужой» push. */
async function repos(): Promise<{
  readonly mine: Git;
  readonly other: Git;
  readonly dirs: string[];
}> {
  const root = await mkdtemp(join(tmpdir(), 'hexfront-git-'));
  roots.push(root);
  const bare = join(root, 'origin.git');
  const mine = join(root, 'mine');
  const other = join(root, 'other');
  const shell = makeGit(defaultRunCommand, root);
  await shell.run(['init', '--bare', '-b', 'main', bare]);
  await shell.run(['clone', bare, mine]);
  const gitMine = makeGit(defaultRunCommand, mine);
  for (const args of [
    ['config', 'user.email', 'loop@test'],
    ['config', 'user.name', 'loop'],
    ['config', 'core.hooksPath', 'no-hooks'],
    ['commit', '--allow-empty', '-m', 'init'],
    ['push', 'origin', 'main'],
    ['checkout', '-b', 'stage-06'],
    ['push', '-u', 'origin', 'stage-06'],
  ])
    await gitMine.run(args);
  await shell.run(['clone', '-b', 'stage-06', bare, other]);
  const gitOther = makeGit(defaultRunCommand, other);
  await gitOther.run(['config', 'user.email', 'other@test']);
  await gitOther.run(['config', 'user.name', 'other']);
  await gitOther.run(['config', 'core.hooksPath', 'no-hooks']);
  return { mine: gitMine, other: gitOther, dirs: [mine, other] };
}

async function commitFile(git: Git, dir: string, file: string, text: string): Promise<void> {
  await writeFile(join(dir, file), text);
  await git.run(['add', file]);
  await git.run(['commit', '-m', file]);
}

afterEach(async () => {
  // На Windows только что завершённый git ещё секунды держит файлы: без повторов rm падает EBUSY.
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  );
});

// Тест запускает 15–20 настоящих процессов git; на Windows каждый идёт через cmd и стоит
// сотни миллисекунд, поэтому 5 с по умолчанию проверяли бы скорость ПК, а не код
// (2026-10-14: $stage-close 06 остановился на таймауте). Предел — защита от зависания.
describe('сведение ветки с origin на настоящем git', { timeout: 60_000 }, () => {
  it('передаёт сообщение коммита с пробелами одним аргументом', async () => {
    const { mine } = await repos();
    await mine.run([
      'commit',
      '--allow-empty',
      '-m',
      'docs(docs): завершена 07/T17ap',
      '-m',
      'Этап: 07/T17ap',
    ]);
    expect(await mine.run(['log', '-1', '--pretty=%B'])).toBe(
      'docs(docs): завершена 07/T17ap\n\nЭтап: 07/T17ap',
    );
  });

  it('отставшую ветку подтягивает, ушедшую вперёд пушит', async () => {
    const { mine, other, dirs } = await repos();
    await commitFile(other, dirs[1] ?? '', 'a.txt', 'a');
    await other.run(['push', 'origin', 'stage-06']);
    expect(await syncWithOrigin(mine, true)).toBeUndefined();
    expect(await head(mine)).toBe(await head(other));
    await commitFile(mine, dirs[0] ?? '', 'b.txt', 'b');
    expect(await syncWithOrigin(mine, true)).toBeUndefined();
    expect(await mine.run(['rev-parse', 'origin/stage-06'])).toBe(await head(mine));
  });

  it('разошедшуюся ветку ставит поверх origin и пушит', async () => {
    const { mine, other, dirs } = await repos();
    await commitFile(other, dirs[1] ?? '', 'a.txt', 'a');
    await other.run(['push', 'origin', 'stage-06']);
    await commitFile(mine, dirs[0] ?? '', 'b.txt', 'b');
    expect(await syncWithOrigin(mine, true)).toBeUndefined();
    await other.run(['pull', '--ff-only', 'origin', 'stage-06']);
    expect(await head(other)).toBe(await head(mine));
  });

  it('при конфликте откатывает rebase и называет причину', async () => {
    const { mine, other, dirs } = await repos();
    await commitFile(other, dirs[1] ?? '', 'same.txt', 'чужое');
    await other.run(['push', 'origin', 'stage-06']);
    await commitFile(mine, dirs[0] ?? '', 'same.txt', 'моё');
    const before = await head(mine);
    expect(await syncWithOrigin(mine, true)).toMatch(/rebase откатан/);
    expect(await head(mine)).toBe(before);
    expect(await mine.run(['status', '--porcelain'])).toBe('');
  });

  it('видит обычный и squash-мерж ветки этапа в main', async () => {
    const { mine, dirs } = await repos();
    expect(await mergedIntoMain(mine)).toBe(true);
    await commitFile(mine, dirs[0] ?? '', 'report.md', 'этап закрыт');
    expect(await mergedIntoMain(mine)).toBe(false);
    await mine.run(['checkout', 'main']);
    await mine.run(['merge', '--squash', 'stage-06']);
    await mine.run(['commit', '-m', 'squash']);
    await mine.run(['push', 'origin', 'main']);
    await mine.run(['checkout', 'stage-06']);
    expect(await mergedIntoMain(mine)).toBe(true);
  });
});
