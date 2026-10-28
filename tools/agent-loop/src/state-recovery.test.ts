import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadState, saveState, statePath } from './state.ts';

describe('память цикла после повреждения JSON', () => {
  it('восстанавливает последний сохранённый снимок и сохраняет битый файл для диагностики', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hexfront-state-recovery-'));
    try {
      const state = await loadState(root);
      state.activeTask = {
        task: '07/T17baa',
        base: 'abc',
        workPrompt: '$task 07/T17baa',
        phase: 'work',
        findings: [],
        workDirtyPaths: ['apps/client/src/dev/UnitCard.tsx'],
      };
      await saveState(root, state);
      state.activeTask.workDirtyPaths = [
        'apps/client/src/dev/UnitCard.tsx',
        'apps/client/src/dev/HexCard.module.css',
      ];
      await saveState(root, state);
      await writeFile(statePath(root), '{"activeTask":', 'utf8');

      const restored = await loadState(root);
      expect(restored.activeTask?.task).toBe('07/T17baa');
      expect(restored.activeTask?.workDirtyPaths).toEqual([
        'apps/client/src/dev/UnitCard.tsx',
        'apps/client/src/dev/HexCard.module.css',
      ]);
      expect(JSON.parse(await readFile(statePath(root), 'utf8'))).toHaveProperty('activeTask');
      const files = await readdir(join(root, '.ai-logs/agent-loop'));
      expect(files.some((file) => file.startsWith('state.json.corrupt-'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
