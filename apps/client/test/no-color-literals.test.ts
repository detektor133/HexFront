import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
// Цвета — только из токенов (AGENTS.md §7); theme/ — сгенерированные токены.
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('цвета клиента', () => {
  it('в apps/client/src вне theme/ нет цветовых литералов', () => {
    const offenders = files(SRC)
      .filter((f) => !relative(SRC, f).startsWith('theme'))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ f: relative(SRC, f), i: i + 1, line }))
          .filter(({ line }) => COLOR.test(line)),
      );
    expect(offenders).toEqual([]);
  });
});
