// Эскалация от точечного патча к переделке: счётчик подряд патчей одного продуктового файла.
import { describe, expect, it } from 'vitest';

import type { ActiveTask } from './state.ts';
import {
  REDESIGN_STREAK,
  dominantProductFile,
  mentionsStreakFile,
  updateFixStreak,
} from './tasks.ts';

const baseTask = (): ActiveTask => ({
  task: '07/T17aq',
  base: 'c0',
  workPrompt: '$task 07/T17aq',
  phase: 'work',
  findings: [],
});

describe('dominantProductFile', () => {
  it('находит первый продуктовый файл apps/client/src', () => {
    expect(
      dominantProductFile(['docs/stages/stage-07.md', 'apps/client/src/dev/Hud.module.css']),
    ).toBe('apps/client/src/dev/Hud.module.css');
  });

  it('не считает тестовые файлы продуктовыми', () => {
    expect(
      dominantProductFile(['apps/client/test/hud.test.tsx', 'apps/client/tests/e2e/hud.spec.ts']),
    ).toBeUndefined();
  });

  it('игнорирует файлы вне apps/client/src', () => {
    expect(dominantProductFile(['packages/sim/src/systems/combat.ts'])).toBeUndefined();
  });
});

describe('updateFixStreak', () => {
  it('начинает счётчик с 1 на первом патче файла', () => {
    const active = baseTask();
    updateFixStreak(active, ['apps/client/src/dev/Hud.module.css']);
    expect(active.fixStreak).toEqual({ file: 'apps/client/src/dev/Hud.module.css', count: 1 });
  });

  it('увеличивает счётчик на повторном патче того же файла', () => {
    const active = baseTask();
    active.fixStreak = { file: 'apps/client/src/dev/Hud.module.css', count: 2 };
    updateFixStreak(active, ['apps/client/src/dev/Hud.module.css']);
    expect(active.fixStreak).toEqual({ file: 'apps/client/src/dev/Hud.module.css', count: 3 });
  });

  it('сбрасывает счётчик на патче другого файла', () => {
    const active = baseTask();
    active.fixStreak = { file: 'apps/client/src/dev/Hud.module.css', count: 2 };
    updateFixStreak(active, ['apps/client/src/dev/Hud.tsx']);
    expect(active.fixStreak).toEqual({ file: 'apps/client/src/dev/Hud.tsx', count: 1 });
  });

  it('не трогает счётчик, если круг не задел продуктовый файл', () => {
    const active = baseTask();
    active.fixStreak = { file: 'apps/client/src/dev/Hud.module.css', count: 2 };
    updateFixStreak(active, ['apps/client/test/hud.test.tsx']);
    expect(active.fixStreak).toEqual({ file: 'apps/client/src/dev/Hud.module.css', count: 2 });
  });

  it('порог эскалации — три подряд патча одного файла', () => {
    expect(REDESIGN_STREAK).toBe(3);
  });
});

describe('mentionsStreakFile', () => {
  it('находит файл по полному пути', () => {
    expect(
      mentionsStreakFile(
        'КОД: в apps/client/src/dev/Hud.module.css:309',
        'apps/client/src/dev/Hud.module.css',
      ),
    ).toBe(true);
  });

  it('находит файл по одному имени без пути (markdown-ссылка reviewer)', () => {
    expect(
      mentionsStreakFile(
        'КОД: в [Hud.module.css](Hud.module.css:309)',
        'apps/client/src/dev/Hud.module.css',
      ),
    ).toBe(true);
  });

  it('не находит другой файл', () => {
    expect(mentionsStreakFile('КОД: в Hud.tsx:10', 'apps/client/src/dev/Hud.module.css')).toBe(
      false,
    );
  });
});
