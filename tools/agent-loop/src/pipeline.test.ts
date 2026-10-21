import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadState } from './state.ts';
import { runWorld, type Session } from './test-world.ts';

describe('обычный конвейер задачи', () => {
  it('передаёт исполнителю тесты и код без автоматического $spec', async () => {
    const done: Session = {
      task: 'T1j5-Б1',
      mark: '~',
      answer: 'Тесты и код добавлены одним коммитом.',
    };
    const review: Session = { task: 'T1j5-Б1', mark: 'x', answer: 'OK' };
    const run = await runWorld({
      plan: true,
      sessions: [{ answer: 'PLAN: не трогал' }, done, review],
    });

    expect(run.prompts).toEqual(['$plan 06/T1j5-Б1', '$task 06/T1j5-Б1', '$review 06/T1j5-Б1']);
    expect(run.roles).toEqual(['plan', '', 'reviewer']);
    expect(run.locked).toEqual(['', '', '']);
  });

  it('загружает старые поля ручного $spec без влияния на очередь', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hexfront-state-'));
    try {
      const path = join(root, '.ai-logs', 'agent-loop', 'state.json');
      await mkdir(join(root, '.ai-logs', 'agent-loop'), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          spec: { '07/T1': {} },
          specUnlocked: { '07/T1': [] },
          specRepairNotes: { '07/T1': [] },
        }),
        'utf8',
      );
      const state = await loadState(root);

      expect(state.spec).toEqual({ '07/T1': {} });
      expect(state.specUnlocked).toEqual({ '07/T1': [] });
      expect(state.specRepairNotes).toEqual({ '07/T1': [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
