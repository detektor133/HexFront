import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Board } from './board.ts';
import { createWorld, STAGE_FILE, type StreamsWorld, type WorldHandle } from './streams-world.ts';

const worlds: WorldHandle[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.dispose()));
});

const task = (id: string, extra = ''): string =>
  `- [ ] **${id}. Задача ${id}** (\`src\`).\n  *Приёмка:* тест.${extra}\n`;
const stageOf = (...tasks: string[]): string => `# Этап 07\n\n## Задачи\n\n${tasks.join('\n')}`;

async function world(spec: StreamsWorld): Promise<WorldHandle> {
  const handle = await createWorld(spec);
  worlds.push(handle);
  return handle;
}

const workPrompt = (short: string) => `$task 07/${short}`;
const index = (events: readonly string[], event: string): number => {
  const found = events.indexOf(event);
  if (found < 0) throw new Error(`нет события ${event}: ${events.join(' | ')}`);
  return found;
};

/** Итог на ветке этапа в origin: все задачи [x], файлы задач на месте, веток потоков нет. */
async function expectMerged(handle: WorldHandle, shorts: readonly string[]): Promise<void> {
  const stage = (await handle.originFile(STAGE_FILE)) ?? '';
  for (const short of shorts) expect(stage).toContain(`- [x] **${short}.`);
  const remote = await handle.git(handle.root, 'ls-remote', '--heads', 'origin');
  expect(remote).not.toContain('refs/heads/agent/');
  expect(await handle.git(handle.root, 'status', '--porcelain')).toBe('');
}

// Настоящий git: каждый сценарий — сотни процессов git, на Windows через cmd; предел — от зависания.
describe('параллельные потоки на настоящем git', { timeout: 120_000 }, () => {
  it('две задачи без пересечений идут одновременно и обе вливаются в ветку этапа', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: { workMs: 300 }, T2: { workMs: 300 } },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(run.code).toBe(0);
    // Вторая работа началась раньше, чем закончилась первая: потоки шли одновременно.
    expect(index(run.events, `start:${workPrompt('T2')}`)).toBeLessThan(
      index(run.events, `end:${workPrompt('T1')}`),
    );
    await expectMerged(handle, ['T1', 'T2']);
    expect(await handle.originFile('src/T1.txt')).toBe('T1\n');
    expect(await handle.originFile('src/T2.txt')).toBe('T2\n');
    // Работа шла в каталогах потоков, а не в главном.
    expect(run.prompts.filter((p) => p.prompt.startsWith('$task')).map((p) => p.cwd)).not.toContain(
      handle.root,
    );
    expect(
      run.prompts.every((p) => !p.prompt.startsWith('$task') || p.prompt.includes('Поток w')),
    ).toBe(true);
    // Отметки этапа и отчёт меняют обе задачи — это не повод для повторного ревью.
    expect(run.prompts.filter((p) => p.prompt.includes('Повторное ревью'))).toEqual([]);
  });

  it('пересечение по «Файлы:» — вторая задача ждёт слияния первой', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/**`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: { workMs: 100 }, T2: {} },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(index(run.events, `start:${workPrompt('T2')}`)).toBeGreaterThan(
      index(run.events, 'end:$review 07/T1'),
    );
    await expectMerged(handle, ['T1', 'T2']);
  });

  it('без строк «Файлы:» и «После:» задачи идут по одной, как раньше', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(task('T1'), task('T2')),
      tasks: { T1: { workMs: 100 }, T2: {} },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(index(run.events, `start:${workPrompt('T2')}`)).toBeGreaterThan(
      index(run.events, 'end:$review 07/T1'),
    );
    await expectMerged(handle, ['T1', 'T2']);
  });

  it('«После:» — задача ждёт свою зависимость, независимая идёт рядом', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2 → 07/T3',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* T1'),
        task('T3', '\n  *Файлы:* `src/T3.txt`\n  *После:* —'),
      ),
      tasks: { T1: { workMs: 200 }, T2: {}, T3: { workMs: 200 } },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(index(run.events, `start:${workPrompt('T3')}`)).toBeLessThan(
      index(run.events, `end:${workPrompt('T1')}`),
    );
    expect(index(run.events, `start:${workPrompt('T2')}`)).toBeGreaterThan(
      index(run.events, 'end:$review 07/T1'),
    );
    await expectMerged(handle, ['T1', 'T2', 'T3']);
  });

  it('непредсказанный конфликт: сессия слияния, повторное ревью, обе правки в ветке этапа', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: {
        T1: { workMs: 50, writes: { 'src/shared.txt': 'правка T1\n' } },
        T2: { workMs: 300, writes: { 'src/shared.txt': 'правка T2\n' } },
      },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(run.events).toContain(
      'start:$task 07/T2 слияние: влей origin/stage-07 в текущую ветку (git merge origin/stage-07), разреши конфликты по смыслу обеих сторон, pnpm verify --changed, коммит слияния с трейлером «Этап: 07/T2», push.',
    );
    const reReview = run.prompts.find(
      (p) => p.prompt.startsWith('$review 07/T2') && p.prompt.includes('Повторное ревью'),
    );
    expect(reReview?.prompt).toContain('конфликт слияния разрешён');
    expect(reReview?.prompt).toContain('файлы вне «Файлы:» задачи: src/shared.txt');
    await expectMerged(handle, ['T1', 'T2']);
    const shared = (await handle.originFile('src/shared.txt')) ?? '';
    expect(shared).toContain('правка T1');
    expect(shared).toContain('правка T2');
  });

  it('чистое слияние тех же файлов — повторное ревью без сессии слияния', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/shared.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`, `src/shared.txt`\n  *После:* —'),
      ).replace('`src/shared.txt`\n  *После:* —\n', '`src/shared.txt`\n  *После:* —\n'),
      tasks: {
        T1: { workMs: 50, writes: { 'src/shared.txt': '^строка T1' } },
        T2: { workMs: 300, writes: { 'src/shared.txt': '+строка T2' } },
      },
    };
    // Объём пересекается, поэтому T2 пошла бы после T1; разводим их, объявив T2 без shared.txt.
    const disjoint: StreamsWorld = {
      ...spec,
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/shared.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
    };
    const handle = await world(disjoint);
    const run = await handle.run(disjoint);
    expect(run.events.some((event) => event.includes('слияние'))).toBe(false);
    const reReview = run.prompts.find(
      (p) => p.prompt.startsWith('$review 07/T2') && p.prompt.includes('Повторное ревью'),
    );
    expect(reReview?.prompt).toContain(
      'ветка этапа за время задачи меняла те же файлы: src/shared.txt',
    );
    await expectMerged(handle, ['T1', 'T2']);
    const shared = (await handle.originFile('src/shared.txt')) ?? '';
    expect(shared).toContain('строка T1');
    expect(shared).toContain('строка T2');
  });

  it('красный CI в одном потоке чинит его сессия, второй поток не задет', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1*`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: { workMs: 50 }, T2: { workMs: 400 } },
      ci: ['failure'],
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    const fix = run.prompts.find((p) => p.prompt.startsWith('$task 07/T1 CI красный'));
    expect(fix?.cwd).toContain('Hexfront-streams');
    await expectMerged(handle, ['T1', 'T2']);
    expect(await handle.originFile('src/T1-fix.txt')).toBe('исправлено\n');
  });

  it('ВОЗВРАТ ревью в потоке — новый круг работы в том же потоке', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: { reviews: ['ВОЗВРАТ'] }, T2: {} },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(run.prompts.filter((p) => p.prompt.startsWith(workPrompt('T1'))).length).toBe(2);
    await expectMerged(handle, ['T1', 'T2']);
  });

  it('$decide меняет задачу в работе — поток бросает работу и начинает её заново', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: { workMs: 20 }, T2: { workMs: 600 } },
      decide: {
        atList: 2,
        stage: (text) => text.replace('Задача T2**', 'Задача T2, новый текст**'),
      },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(run.lines.some((line) => line.includes('текст 07/T2 изменён Issue'))).toBe(true);
    expect(run.prompts.filter((p) => p.prompt.startsWith(workPrompt('T2'))).length).toBe(2);
    await expectMerged(handle, ['T1', 'T2']);
    expect(await handle.originFile(STAGE_FILE)).toContain('новый текст');
  });

  it('задача владельца в очереди не держит независимую задачу после неё', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T5 → 07/T6',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        '- [ ] **T5. Публикация**, задача владельца.\n',
        task('T6', '\n  *Файлы:* `src/T6.txt`\n  *После:* T1'),
      ),
      tasks: { T1: {}, T6: {} },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(run.prompts.some((p) => p.prompt.includes('07/T5'))).toBe(false);
    await expectMerged(handle, ['T1', 'T6']);
    expect(run.lines.some((line) => line.includes('07/T5 — это задача владельца'))).toBe(true);
  });

  it('обрыв сессии и перезапуск цикла — поток доделывает свою незакоммиченную работу', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: {}, T2: { crashes: 1 } },
    };
    const handle = await world(spec);
    const first = await handle.run(spec);
    expect(first.lines.some((line) => line.includes('сбой:'))).toBe(true);
    expect(await handle.originFile(STAGE_FILE)).toContain('- [ ] **T2.');
    // Перезапуск цикла владельцем: поток w2 на ветке agent/07-T2 с файлами обрыва.
    const second = await handle.run(spec);
    expect(second.prompts.some((p) => p.prompt.startsWith('$task 07/T2 продолжить'))).toBe(true);
    await expectMerged(handle, ['T1', 'T2']);
  });

  it('после всех слияний потоки свободны и цикл закрывает этап', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: {}, T2: { workMs: 200 } },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    const close = run.events.indexOf('start:$stage-close');
    expect(close).toBeGreaterThan(index(run.events, 'end:$review 07/T2'));
    expect(close).toBeGreaterThan(index(run.events, 'end:$review 07/T1'));
  });
  it('работа владельца в главном каталоге — слияние ждёт, ветка задачи не теряется', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1',
      stage: stageOf(task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —')),
      tasks: { T1: {} },
    };
    const handle = await world(spec);
    const owner = join(handle.root, 'weights.json');
    await writeFile(owner, '{}');
    const first = await handle.run(spec);
    expect(first.lines.some((line) => line.includes('главный каталог не чистый'))).toBe(true);
    expect(await handle.originFile(STAGE_FILE)).toContain('- [ ] **T1.');
    expect(await handle.git(handle.root, 'branch', '--list', 'agent/07-T1')).toContain(
      'agent/07-T1',
    );
    await rm(owner);
    await handle.run(spec);
    await expectMerged(handle, ['T1']);
  });
  it('вопрос владельцу держит поток; после ответа новые коммиты этапа вливаются и пушатся, работа идёт дальше', async () => {
    const stage = stageOf(
      task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
      task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
    );
    const asking: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage,
      tasks: { T1: {}, T2: { asks: 1, workMs: 200 } },
    };
    const handle = await world(asking);
    const first = await handle.run(asking);
    expect(first.lines.some((line) => line.includes('поток w2 ждёт'))).toBe(true);
    // Слияние T1 — не ответ владельца: T2 не перезапускается впустую.
    expect(first.prompts.filter((p) => p.prompt.startsWith('$task 07/T2')).length).toBe(1);
    expect(await handle.originFile(STAGE_FILE)).toContain('- [x] **T1.');
    // Ответ владельца — Issue $decide; она меняет не блок T2, поэтому работа не отбрасывается.
    const answer: StreamsWorld = {
      ...asking,
      tasks: { T2: {} },
      decide: {
        atList: 1,
        stage: (text) => text.replace('# Этап 07', '# Этап 07 (решение владельца)'),
      },
    };
    const second = await handle.run(answer);
    expect(second.lines.some((line) => line.includes('влиты новые коммиты stage-07'))).toBe(true);
    await expectMerged(handle, ['T1', 'T2']);
    expect(await handle.originFile(STAGE_FILE)).toContain('(решение владельца)');
  });

  it('Issue $streams 2 в режиме одного агента — цикл сам переходит на потоки', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: { workMs: 300 }, T2: { workMs: 300 } },
      streams: 1,
      commands: [{ atList: 1, body: '$streams 2' }],
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(run.lines).toContain('режим: до 2 задач одновременно');
    expect(index(run.events, `start:${workPrompt('T2')}`)).toBeLessThan(
      index(run.events, `end:${workPrompt('T1')}`),
    );
    expect(run.prompts.some((p) => p.prompt.startsWith('$next'))).toBe(false);
    await expectMerged(handle, ['T1', 'T2']);
  });

  it('владелец поднял число агентов в консоли — цикл переходит на потоки, как по Issue', async () => {
    const board = new Board(Date.now);
    board.requestLimit(2);
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: { T1: { workMs: 300 }, T2: { workMs: 300 } },
      streams: 1,
      board,
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    expect(run.lines).toContain('консоль: агентов до 2');
    expect(run.lines).toContain('режим: до 2 задач одновременно');
    expect(index(run.events, `start:${workPrompt('T2')}`)).toBeLessThan(
      index(run.events, `end:${workPrompt('T1')}`),
    );
    expect(board.totals.done).toBe(2);
    await expectMerged(handle, ['T1', 'T2']);
  });

  it('Issue $streams 1 посреди работы — начатые задачи доделываются, следующая идёт одна в главном каталоге', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2 → 07/T3',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
        task('T3', '\n  *Файлы:* `src/T3.txt`\n  *После:* —'),
      ),
      tasks: { T1: { workMs: 300 }, T2: { workMs: 500 }, T3: {} },
      commands: [{ atList: 2, body: '$streams 1' }],
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    // T3 свободна, но предел уже 1: она ждёт, пока доделаются T1 и T2, и идёт без потоков.
    const third = run.prompts.find((p) => p.prompt.startsWith('$next'));
    expect(third?.cwd).toBe(handle.root);
    expect(run.events.indexOf('start:$next')).toBeGreaterThan(
      index(run.events, 'end:$review 07/T2'),
    );
    expect(run.prompts.some((p) => p.prompt.startsWith(workPrompt('T3')))).toBe(false);
    expect(run.lines).toContain('режим: одна задача в главном каталоге');
    await expectMerged(handle, ['T1', 'T2', 'T3']);
    expect(await handle.originFile('src/T3.txt')).toBe('T3\n');
  });

  it('новый файл вне «Файлы:» (тест задачи) — без повторного ревью, правка чужого — с ним', async () => {
    const spec: StreamsWorld = {
      queue: '07/T1 → 07/T2',
      stage: stageOf(
        task('T1', '\n  *Файлы:* `src/T1.txt`\n  *После:* —'),
        task('T2', '\n  *Файлы:* `src/T2.txt`\n  *После:* —'),
      ),
      tasks: {
        T1: { writes: { 'src/T1.txt': 'T1\n', 'test/T1-arc.test.txt': 'тест\n' } },
        T2: { workMs: 200, writes: { 'src/T2.txt': 'T2\n', 'src/shared.txt': '+строка T2' } },
      },
    };
    const handle = await world(spec);
    const run = await handle.run(spec);
    const reReviews = run.prompts.filter((p) => p.prompt.includes('Повторное ревью'));
    expect(reReviews.map((p) => p.prompt.split('\n', 1)[0])).toEqual(['$review 07/T2']);
    expect(reReviews[0]?.prompt).toContain('файлы вне «Файлы:» задачи: src/shared.txt');
    await expectMerged(handle, ['T1', 'T2']);
  });
});
