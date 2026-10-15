import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const VISUAL = ['visual'].join('');
const VISUAL_SCRIPT = ['pnpm', VISUAL].join(' ');
const VISUAL_PATH = ['tests', VISUAL].join('/');
const VISUAL_UPDATE = [VISUAL, '--update'].join(' ');
const VISUAL_STEP = ['name:', VISUAL].join(" '") + "'";

function readProjectFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function listTextFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const projectPath = relative(ROOT, path).replaceAll('\\', '/');
    if (projectPath.startsWith('docs/reports/') || projectPath.startsWith('docs/stages/')) {
      continue;
    }
    if (
      entry.isDirectory() &&
      !['.git', '.ai-logs', 'coverage', 'dist', 'node_modules'].includes(entry.name)
    ) {
      files.push(...listTextFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

describe('07/T20 — без скриншотов', () => {
  it('критерий 1: список шагов verify не содержит visual', () => {
    const verify = readProjectFile('tools/ai-check/src/verify.ts');
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(verify).not.toContain(VISUAL_SCRIPT);
    expect(verify).not.toContain(VISUAL_UPDATE);
    expect(verify).not.toContain(VISUAL_STEP);
    expect(packageJson.scripts?.verify).toBeDefined();
    expect(packageJson.scripts?.visual).toBeUndefined();
  });

  it('критерий 2: запрещённые ссылки visual отсутствуют вне docs/reports и docs/stages', () => {
    const forbidden = [VISUAL_SCRIPT, VISUAL_PATH, VISUAL_UPDATE];
    const matches: string[] = [];

    for (const file of listTextFiles(ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const phrase of forbidden) {
        if (text.includes(phrase)) matches.push(`${relative(ROOT, file)}: ${phrase}`);
      }
    }

    expect(matches).toEqual([]);
  });

  it('критерий 3: каталог visual и файл src/match/layout.ts удалены', () => {
    expect(existsSync(join(ROOT, 'apps', 'client', VISUAL_PATH))).toBe(false);
    expect(existsSync(join(ROOT, 'src', 'match', 'layout.ts'))).toBe(false);
  });
});
