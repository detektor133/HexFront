import { describe, expect, it } from 'vitest';

import type { Git } from './git.ts';
import {
  outOfScopeRemarks,
  parseChangedLines,
  previousRefs,
  remarkLines,
  remarkRefs,
  reviewScope,
  scopeNote,
  taskText,
  type ReviewScope,
} from './review-scope.ts';

// Как 07/T7, коммит 2dc88d3: тест переименован в .dom.test.tsx и поправлен в нескольких местах.
const RENAME_DIFF = `diff --git a/apps/client/test/match-layout.test.ts b/apps/client/test/match-layout.dom.test.tsx
similarity index 91%
rename from apps/client/test/match-layout.test.ts
rename to apps/client/test/match-layout.dom.test.tsx
index 1111111..2222222 100644
--- a/apps/client/test/match-layout.test.ts
+++ b/apps/client/test/match-layout.dom.test.tsx
@@ -92 +92 @@ const SCENES = [
-  old
+  new
@@ -230,2 +234,3 @@ describe('раскладка', () => {
-  a
-  b
+  a
+  b
+  c
@@ -300 +305,0 @@ it('x', () => {
-  removed
diff --git a/apps/client/test/pause.test.ts b/apps/client/test/pause.test.ts
index 3333333..4444444 100644
--- a/apps/client/test/pause.test.ts
+++ b/apps/client/test/pause.test.ts
@@ -359 +359 @@ it('пауза', () => {
-  old
+  new
diff --git a/apps/client/test/gone.test.ts b/apps/client/test/gone.test.ts
deleted file mode 100644
--- a/apps/client/test/gone.test.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-  x
`;

const TEST = 'apps/client/test/match-layout.dom.test.tsx';
const narrow = (previous = ''): ReviewScope => {
  const changed = parseChangedLines(RENAME_DIFF);
  return {
    kind: 'narrow',
    base: 'abcdef1234',
    changed,
    previous: previousRefs(previous, changed.renames),
  };
};

describe('разбор diff после прошлого возврата', () => {
  it('берёт строки нового файла, переименование — не новый файл', () => {
    const changed = parseChangedLines(RENAME_DIFF);
    expect(changed.renames).toEqual({ 'apps/client/test/match-layout.test.ts': TEST });
    expect(changed.ranges[TEST]).toEqual([
      [92, 92],
      [234, 236],
      [305, 306],
    ]);
    expect(changed.ranges['apps/client/test/pause.test.ts']).toEqual([[359, 359]]);
  });

  it('удалённый файл строк не даёт, пустой diff — пусто', () => {
    expect(parseChangedLines(RENAME_DIFF).ranges).not.toHaveProperty(
      'apps/client/test/gone.test.ts',
    );
    expect(parseChangedLines('')).toEqual({ ranges: {}, renames: {} });
  });

  it('ссылки замечания: несколько диапазонов, одна строка, путь в кавычках и без', () => {
    expect(remarkRefs(`- СПЕК: \`${TEST}:47-57,90\` и vitest.projects.ts:55`)).toEqual([
      {
        path: TEST,
        ranges: [
          [47, 57],
          [90, 90],
        ],
      },
      { path: 'vitest.projects.ts', ranges: [[55, 55]] },
    ]);
    expect(remarkRefs('- СПЕК: тест не проверяет второй набор высот')).toEqual([]);
  });
});

describe('сходимость повторного ревью', () => {
  it('СПЕК к строкам, которые не менялись (как 07/T7, 7fe94d7), — вне разрешённого', () => {
    const remark = `- СПЕК: \`${TEST}:47-57\` — первый набор измерений использует HUD 91`;
    expect(outOfScopeRemarks(`ВОЗВРАТ\n${remark}`, narrow())).toEqual([remark]);
  });

  it('СПЕК к изменённым строкам — допустим, в том числе по краю диапазона и у удалённой строки', () => {
    const message = [
      'ВОЗВРАТ',
      `- СПЕК: ${TEST}:200-234 — край диапазона`,
      `- СПЕК: ${TEST}:306 — рядом с удалённой строкой`,
      '- СПЕК: pause.test.ts:359 — по имени файла',
    ].join('\n');
    expect(outOfScopeRemarks(message, narrow())).toEqual([]);
  });

  it('ссылка на старое имя переименованного файла сопоставляется через diff', () => {
    const scope = narrow();
    expect(
      outOfScopeRemarks('- СПЕК: apps/client/test/match-layout.test.ts:1', scope),
    ).toHaveLength(1);
    expect(outOfScopeRemarks(`- СПЕК: ${TEST}:92`, scope)).toEqual([]);
  });

  it('пункт прошлого возврата можно вернуть снова, даже если строки не менялись', () => {
    const block = [
      '- [ ] **T7. Раскладка**',
      '  Возврат ревью:',
      '  - СПЕК: `apps/client/test/match-layout.test.ts:40-60` не сверяет второй набор',
      ' *Приёмка:* тест.',
    ].join('\n');
    expect(outOfScopeRemarks(`- СПЕК: ${TEST}:47-57 всё ещё один набор`, narrow(block))).toEqual(
      [],
    );
  });

  it('замечания без ссылок и не СПЕК цикл не отклоняет; первое ревью и reset — без проверки', () => {
    const message = 'ВОЗВРАТ\n- СПЕК: нет проверки клика\n- layout.ts:1-3 — нет меню паузы';
    expect(outOfScopeRemarks(message, narrow())).toEqual([]);
    const remark = `- СПЕК: ${TEST}:47-57`;
    expect(outOfScopeRemarks(remark, { kind: 'first' })).toEqual([]);
    expect(outOfScopeRemarks(remark, { kind: 'reset', base: 'abc' })).toEqual([]);
  });

  it('пункты возврата — строки списка после вердикта', () => {
    expect(remarkLines('ВОЗВРАТ\n- первый\n  * второй\nпросто текст')).toEqual([
      '- первый',
      '* второй',
    ]);
  });
});

describe('текст задачи', () => {
  const block = `- [ ] **T7. Раскладка**. Критерии.
  Возврат ревью:
  - СПЕК: a.ts:1 нет проверки
  - b.ts:2 хардкод
 *Приёмка:* тест на 88/150/300.`;

  it('отметка и строки возвратов текст задачи не меняют', () => {
    const marked = block
      .replace('- [ ]', '- [~]')
      .replace(/ {2}Возврат ревью:\n(?: {2}- .*\n)+/u, '');
    expect(taskText(marked)).toBe(taskText(block));
    expect(taskText(block)).not.toContain('Возврат');
  });

  it('изменённая приёмка — другой текст', () => {
    expect(taskText(block.replace('88/150/300', '91/157/303'))).not.toBe(taskText(block));
  });
});

const fakeGit = (answers: Record<string, { code: number; stdout: string }>): Git => {
  const attempt = (args: readonly string[]) => {
    const answer = answers[args[0] ?? ''] ?? { code: 1, stdout: '' };
    return Promise.resolve({ ...answer, stderr: '' });
  };
  return {
    attempt,
    run: async (args) => (await attempt(args)).stdout,
  };
};

describe('reviewScope', () => {
  const stage = '# Этап\n\n- [~] **T7. Раскладка**. Критерии.\n *Приёмка:* тест.\n';
  const atBase = stage
    .replace('[~]', '[ ]')
    .replace(' *Приёмка', '  Возврат ревью:\n  - СПЕК: a.ts:1\n *Приёмка');

  it('без прошлого возврата — первое ревью', async () => {
    expect(await reviewScope(fakeGit({}), '07/T7', undefined, 's.md', stage)).toEqual({
      kind: 'first',
    });
  });

  it('тот же текст задачи — только изменённые строки', async () => {
    const git = fakeGit({
      show: { code: 0, stdout: atBase },
      diff: { code: 0, stdout: RENAME_DIFF },
    });
    const scope = await reviewScope(git, '07/T7', 'abc', 's.md', stage);
    expect(scope.kind).toBe('narrow');
    expect(scopeNote(scope).join('\n')).toContain(`${TEST}:92,234-236,305-306`);
    expect(scopeNote(scope).join('\n')).toContain('не новые файлы');
  });

  it('текст задачи изменён после возврата — ревью целиком', async () => {
    const git = fakeGit({ show: { code: 0, stdout: atBase.replace('тест.', 'другой тест.') } });
    expect(await reviewScope(git, '07/T7', 'abc', 's.md', stage)).toEqual({
      kind: 'reset',
      base: 'abc',
    });
  });

  it('коммит возврата не прочитать — без ограничений, как раньше', async () => {
    expect(await reviewScope(fakeGit({}), '07/T7', 'abc', 's.md', stage)).toEqual({
      kind: 'first',
    });
    expect(scopeNote({ kind: 'first' })).toEqual([]);
  });
});
