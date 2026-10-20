import { describe, expect, it } from 'vitest';

import { globsOverlap, outsideScope, scopesOverlap, selectStreamTask, taskScope } from './scope.ts';

const status = (queue: string): string => `| Текущий этап | 07 |\n\nОчередь: ${queue}\n`;

describe('объём задачи для потоков', () => {
  it('читает «Файлы:» и «После:» из блока; «—» — пустой список', () => {
    const block =
      '- [ ] **T6. Пауза** (`apps/client`).\n  *Файлы:* `apps/client/src/match/**`, `apps/client/src/dev/Hud.tsx`\n  *После:* T2, 07/T3\n';
    expect(taskScope(block)).toEqual({
      files: ['apps/client/src/match/**', 'apps/client/src/dev/Hud.tsx'],
      after: ['T2', 'T3'],
    });
    expect(taskScope('- [ ] **T1. Х**\n  *После:* —\n')).toEqual({ after: [] });
    expect(taskScope('- [ ] **T1. Х**\n  *После:* нет.\n')).toEqual({ after: [] });
    expect(taskScope('- [ ] **T1. Х**\n')).toEqual({});
  });

  it('не пропускает дочернюю задачу перед задачей владельца из-за «После: нет.»', () => {
    const stage = [
      '- [ ] **T17am. Дочерняя задача**\n  *Файлы:* `apps/client/src/dev/plan-layer.ts`\n  *После:* нет.\n',
      '- [ ] **T17. Раунд замечаний**, задача владельца.\n',
    ].join('\n');
    expect(selectStreamTask(status('07/T17am → 07/T17'), stage, [])).toBe('07/T17am');
  });

  it('пересечение путей и glob — с запасом, но разные файлы и каталоги не пересекаются', () => {
    expect(globsOverlap('apps/client/src/routes.ts', 'apps/client/src/routes.ts')).toBe(true);
    expect(globsOverlap('apps/client/src/**', 'apps/client/src/routes.ts')).toBe(true);
    expect(globsOverlap('apps/client/src/routes.ts', 'apps/client/**')).toBe(true);
    expect(globsOverlap('apps/client/src/menu/**', 'apps/client/src/match/**')).toBe(false);
    expect(globsOverlap('apps/client/src/a.ts', 'apps/client/src/b.ts')).toBe(false);
    expect(globsOverlap('packages/sim/**', 'apps/client/**')).toBe(false);
  });

  it('задача без «Файлы:» пересекается со всеми', () => {
    expect(scopesOverlap({}, { files: ['a.ts'] })).toBe(true);
    expect(scopesOverlap({ files: ['a.ts'] }, { files: ['b.ts'] })).toBe(false);
  });

  it('берёт первую свободную задачу очереди: без пересечений, с закрытыми зависимостями, не владельца', () => {
    const stage = [
      '- [x] **T1. Готово**\n  *Файлы:* `a/**`\n  *После:* —\n',
      '- [ ] **T2. Экран**\n  *Файлы:* `b/**`\n  *После:* T1\n',
      '- [ ] **T3. Карты**\n  *Файлы:* `b/routes.ts`\n  *После:* —\n',
      '- [ ] **T5. Публикация**, задача владельца.\n',
      '- [ ] **T6. Пауза**\n  *Файлы:* `c/**`\n  *После:* T2\n',
      '- [ ] **T7. Сборка**\n  *Файлы:* `d/**`\n  *После:* T5\n',
      '- [ ] **T8. Без разметки**\n',
    ].join('\n');
    const queue = status('07/T1 → 07/T2 → 07/T3 → 07/T5 → 07/T6 → 07/T7 → 07/T8');
    expect(selectStreamTask(queue, stage, [])).toBe('07/T2');
    // T3 пересекается с T2 по b/routes.ts, T6 ждёт T2, T7 ждёт задачу владельца, T8 ждёт всё перед ней.
    expect(selectStreamTask(queue, stage, ['07/T2'])).toBeUndefined();
    expect(selectStreamTask(queue, stage, ['07/T3'])).toBeUndefined();
  });

  it('задача без «После:» ждёт все задачи перед ней в очереди, включая задачи владельца', () => {
    const stage =
      '- [ ] **T5. Публикация**, задача владельца.\n\n- [ ] **T8. Х**\n  *Файлы:* `x/**`\n';
    expect(selectStreamTask(status('07/T5 → 07/T8'), stage, [])).toBeUndefined();
    const done = stage.replace('- [ ] **T5', '- [x] **T5');
    expect(selectStreamTask(status('07/T5 → 07/T8'), done, [])).toBe('07/T8');
  });

  it('объём: служебные docs не в счёт, файлы вне «Файлы:» перечисляются', () => {
    const scope = { files: ['apps/client/src/match/**'] };
    expect(
      outsideScope(scope, [
        'apps/client/src/match/MatchPage.tsx',
        'docs/stages/stage-07-playable-build.md',
        'docs/reports/stage-07.md',
        'apps/client/src/dev/Hud.tsx',
      ]),
    ).toEqual(['apps/client/src/dev/Hud.tsx']);
    expect(outsideScope({}, ['любой/файл.ts'])).toEqual([]);
  });
});
