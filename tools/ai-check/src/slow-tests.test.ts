import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROJECTS, SLOW_TESTS, testProjects } from '../../../vitest.projects.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

describe('уровни тестов', () => {
  it('каждый тяжёлый файл существует: переименованный файл не уходит молча в быстрый уровень', () => {
    for (const file of SLOW_TESTS) expect(existsSync(join(ROOT, file)), file).toBe(true);
  });

  it('каждый тяжёлый файл лежит в одном из проектов', () => {
    for (const file of SLOW_TESTS)
      expect(
        PROJECTS.some((root) => file.startsWith(`${root}/`)),
        file,
      ).toBe(true);
  });

  it('быстрый уровень исключает тяжёлые файлы, полный — нет', () => {
    const fast = testProjects(false).find((project) => project.test.root === 'packages/sim');
    const all = testProjects(true).find((project) => project.test.root === 'packages/sim');
    expect(fast?.test.exclude).toContain('test/invariants/random-match.test.ts');
    expect(all?.test.exclude).not.toContain('test/invariants/random-match.test.ts');
  });
});
